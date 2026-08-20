use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};

use reqwest::{redirect, StatusCode, Url};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

const LRCLIB_BASE: &str = "https://lrclib.net";
const GENIUS_BASE: &str = "https://genius.com";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const CACHE_CAPACITY: usize = 128;
const HIT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MISS_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsRequest {
    pub track_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLine {
    pub start_ms: Option<u64>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsDocument {
    pub track_id: String,
    pub source: String,
    pub kind: String,
    pub lines: Vec<LyricsLine>,
    pub source_url: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LrcRecord {
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    duration: f64,
    synced_lyrics: Option<String>,
}

#[derive(Clone)]
struct CacheEntry {
    value: Option<LyricsDocument>,
    expires_at: Instant,
}

#[derive(Default)]
struct LyricsCache {
    entries: HashMap<String, CacheEntry>,
    order: VecDeque<String>,
}

impl LyricsCache {
    fn get(&mut self, key: &str) -> Option<Option<LyricsDocument>> {
        let entry = self.entries.get(key)?;
        if entry.expires_at <= Instant::now() {
            self.entries.remove(key);
            self.order.retain(|cached| cached != key);
            return None;
        }
        Some(entry.value.clone())
    }

    fn insert(&mut self, key: String, value: Option<LyricsDocument>) {
        self.order.retain(|cached| cached != &key);
        self.order.push_back(key.clone());
        let ttl = if value.is_some() { HIT_TTL } else { MISS_TTL };
        self.entries.insert(
            key,
            CacheEntry {
                value,
                expires_at: Instant::now() + ttl,
            },
        );
        while self.order.len() > CACHE_CAPACITY {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }
}

pub struct LyricsService {
    client: reqwest::Client,
    cache: tokio::sync::Mutex<LyricsCache>,
}

impl LyricsService {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .user_agent(concat!(
                "Spotagooey/",
                env!("CARGO_PKG_VERSION"),
                " (desktop music client)"
            ))
            .timeout(Duration::from_secs(12))
            .redirect(redirect::Policy::custom(|attempt| {
                let allowed = matches!(
                    attempt.url().host_str(),
                    Some("genius.com" | "www.genius.com" | "lrclib.net" | "www.lrclib.net")
                );
                if allowed && attempt.previous().len() < 5 {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|error| format!("failed to initialize lyrics client: {error}"))?;
        Ok(Self {
            client,
            cache: tokio::sync::Mutex::new(LyricsCache::default()),
        })
    }

    pub async fn get(&self, request: LyricsRequest) -> Result<Option<LyricsDocument>, String> {
        validate_request(&request)?;
        let cache_key = format!("{}:{}", request.track_id, request.duration_ms);
        if let Some(cached) = self.cache.lock().await.get(&cache_key) {
            return Ok(cached);
        }

        let mut failures = Vec::new();
        let document = match self.fetch_lrclib(&request).await {
            Ok(Some(document)) => Some(document),
            Ok(None) => match self.fetch_genius(&request).await {
                Ok(document) => document,
                Err(error) => {
                    failures.push(error);
                    None
                }
            },
            Err(error) => {
                failures.push(error);
                match self.fetch_genius(&request).await {
                    Ok(document) => document,
                    Err(error) => {
                        failures.push(error);
                        None
                    }
                }
            }
        };

        if document.is_none() && !failures.is_empty() {
            return Err(failures.join(" · "));
        }
        self.cache.lock().await.insert(cache_key, document.clone());
        Ok(document)
    }

    async fn fetch_lrclib(
        &self,
        request: &LyricsRequest,
    ) -> Result<Option<LyricsDocument>, String> {
        let full_artist = request.artists.join(", ");
        let primary_artist = request.artists.first().cloned().unwrap_or_default();
        let mut credits = vec![full_artist];
        if credits.first() != Some(&primary_artist) {
            credits.push(primary_artist.clone());
        }

        for artist in credits.iter().filter(|artist| !artist.is_empty()) {
            let params = [
                ("track_name", request.title.clone()),
                ("artist_name", artist.clone()),
                ("album_name", request.album.clone()),
                ("duration", ((request.duration_ms + 500) / 1000).to_string()),
            ];
            let url = format!("{LRCLIB_BASE}/api/get");
            let response = self.get_with_one_rate_limit_retry(&url, &params).await?;
            if response.status() == StatusCode::NOT_FOUND {
                continue;
            }
            if !response.status().is_success() {
                return Err(format!("LRCLIB returned {}", response.status()));
            }
            let record: LrcRecord = decode_json(response).await?;
            if let Some(document) = lrclib_document(request, record) {
                return Ok(Some(document));
            }
        }

        let params = [
            ("track_name", request.title.clone()),
            ("artist_name", primary_artist.clone()),
            ("album_name", request.album.clone()),
        ];
        let url = format!("{LRCLIB_BASE}/api/search");
        let response = self.get_with_one_rate_limit_retry(&url, &params).await?;
        if !response.status().is_success() {
            return Err(format!("LRCLIB search returned {}", response.status()));
        }
        let records: Vec<LrcRecord> = decode_json(response).await?;
        let requested_duration = request.duration_ms as f64 / 1000.0;
        let normalized_title = normalize(&request.title);
        let normalized_artist = normalize(&primary_artist);
        let best = records
            .into_iter()
            .filter(|record| {
                record
                    .synced_lyrics
                    .as_deref()
                    .is_some_and(|lyrics| !lyrics.trim().is_empty())
            })
            .filter(|record| normalize(&record.track_name) == normalized_title)
            .filter(|record| normalize(&record.artist_name).contains(&normalized_artist))
            .filter(|record| (record.duration - requested_duration).abs() <= 3.0)
            .min_by(|left, right| {
                (left.duration - requested_duration)
                    .abs()
                    .total_cmp(&(right.duration - requested_duration).abs())
            });
        Ok(best.and_then(|record| lrclib_document(request, record)))
    }

    async fn get_with_one_rate_limit_retry(
        &self,
        url: &str,
        params: &[(&str, String)],
    ) -> Result<reqwest::Response, String> {
        let mut response = self
            .client
            .get(url)
            .query(params)
            .send()
            .await
            .map_err(|error| format!("LRCLIB request failed: {error}"))?;
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            let wait = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(1)
                .min(10);
            tokio::time::sleep(Duration::from_secs(wait)).await;
            response = self
                .client
                .get(url)
                .query(params)
                .send()
                .await
                .map_err(|error| format!("LRCLIB retry failed: {error}"))?;
        }
        Ok(response)
    }

    async fn fetch_genius(
        &self,
        request: &LyricsRequest,
    ) -> Result<Option<LyricsDocument>, String> {
        let artist = request
            .artists
            .first()
            .map(String::as_str)
            .unwrap_or_default();
        let artist_slug = genius_slug(artist);
        let title_slug = genius_slug(&request.title);
        if artist_slug.is_empty() || title_slug.is_empty() {
            return Ok(None);
        }
        let url = format!("{GENIUS_BASE}/{artist_slug}-{title_slug}-lyrics");
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("Genius request failed: {error}"))?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(format!("Genius returned {}", response.status()));
        }
        let final_url = response.url().clone();
        if !is_expected_genius_page(&final_url, &artist_slug, &title_slug) {
            return Ok(None);
        }
        let html = decode_text(response).await?;
        let lines = parse_genius_html(&html);
        if lines.is_empty() {
            return Ok(None);
        }
        Ok(Some(LyricsDocument {
            track_id: request.track_id.clone(),
            source: "genius".to_string(),
            kind: "plain".to_string(),
            lines,
            source_url: final_url.to_string(),
        }))
    }
}

fn validate_request(request: &LyricsRequest) -> Result<(), String> {
    if request.track_id.trim().is_empty()
        || request.title.trim().is_empty()
        || !request
            .artists
            .iter()
            .any(|artist| !artist.trim().is_empty())
    {
        return Err("track id, title, and at least one artist are required".to_string());
    }
    if request.track_id.len() > 256
        || request.title.len() > 512
        || request.album.len() > 512
        || request.artists.iter().any(|artist| artist.len() > 512)
    {
        return Err("lyrics metadata is too long".to_string());
    }
    Ok(())
}

async fn decode_json<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
) -> Result<T, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("lyrics response was too large".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read lyrics response: {error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("lyrics response was too large".to_string());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to decode lyrics response: {error}"))
}

async fn decode_text(response: reqwest::Response) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("lyrics page was too large".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read lyrics page: {error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("lyrics page was too large".to_string());
    }
    String::from_utf8(bytes.to_vec()).map_err(|error| format!("lyrics page was not UTF-8: {error}"))
}

fn lrclib_document(request: &LyricsRequest, record: LrcRecord) -> Option<LyricsDocument> {
    let lines = parse_lrc(record.synced_lyrics.as_deref()?);
    if lines.is_empty() {
        return None;
    }
    Some(LyricsDocument {
        track_id: request.track_id.clone(),
        source: "lrclib".to_string(),
        kind: "synced".to_string(),
        lines,
        source_url: LRCLIB_BASE.to_string(),
    })
}

fn parse_lrc(input: &str) -> Vec<LyricsLine> {
    let mut lines = Vec::new();
    for raw_line in input.lines() {
        let mut rest = raw_line.trim();
        let mut timestamps = Vec::new();
        while let Some(after_open) = rest.strip_prefix('[') {
            let Some(close) = after_open.find(']') else {
                break;
            };
            let tag = &after_open[..close];
            let Some(timestamp) = parse_lrc_timestamp(tag) else {
                break;
            };
            timestamps.push(timestamp);
            rest = after_open[close + 1..].trim_start();
        }
        for start_ms in timestamps {
            lines.push(LyricsLine {
                start_ms: Some(start_ms),
                text: rest.trim().to_string(),
            });
        }
    }
    lines.sort_by_key(|line| line.start_ms);
    lines
}

fn parse_lrc_timestamp(value: &str) -> Option<u64> {
    let (minutes, seconds) = value.split_once(':')?;
    let minutes = minutes.parse::<u64>().ok()?;
    let seconds = seconds.parse::<f64>().ok()?;
    if !(0.0..60.0).contains(&seconds) {
        return None;
    }
    Some(minutes * 60_000 + (seconds * 1000.0).round() as u64)
}

fn parse_genius_html(input: &str) -> Vec<LyricsLine> {
    let normalized_breaks = input
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n");
    let document = Html::parse_document(&normalized_breaks);
    let selector = Selector::parse(r#"[data-lyrics-container="true"]"#).expect("valid selector");
    document
        .select(&selector)
        .flat_map(|container| {
            container
                .text()
                .collect::<String>()
                .lines()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .map(|line| clean_genius_line(line.trim()))
        .filter(|line| !line.is_empty())
        .map(|text| LyricsLine {
            start_ms: None,
            text,
        })
        .collect()
}

fn clean_genius_line(line: &str) -> String {
    let bytes = line.as_bytes();
    let contributor = bytes
        .windows("contributor".len())
        .position(|window| window.eq_ignore_ascii_case(b"contributor"));
    if let Some(contributor) = contributor.filter(|index| *index <= 24) {
        let remainder = &bytes[contributor..];
        if let Some(lyrics_offset) = remainder
            .windows("lyrics".len())
            .position(|window| window.eq_ignore_ascii_case(b"lyrics"))
        {
            let content_start = contributor + lyrics_offset + "lyrics".len();
            return line[content_start..].trim().to_string();
        }
    }
    line.to_string()
}

fn genius_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            if separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character);
            separator = false;
        } else if matches!(character, '\'' | '’') {
            continue;
        } else {
            separator = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn is_expected_genius_page(url: &Url, artist_slug: &str, title_slug: &str) -> bool {
    if !matches!(url.host_str(), Some("genius.com" | "www.genius.com")) {
        return false;
    }
    let path = url.path().trim_matches('/').to_lowercase();
    path.starts_with(&format!("{artist_slug}-{title_slug}")) && path.ends_with("lyrics")
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lrc_timestamps_and_multiple_tags() {
        let lines = parse_lrc("[ar:Artist]\n[00:01.25][00:02.500] Hello\n[01:03] World");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].start_ms, Some(1_250));
        assert_eq!(lines[1].start_ms, Some(2_500));
        assert_eq!(lines[2].start_ms, Some(63_000));
        assert_eq!(lines[0].text, "Hello");
    }

    #[test]
    fn parses_genius_containers_and_breaks() {
        let html = r#"<div data-lyrics-container="true">[Verse]<br/>First &amp; second<br>Third</div><div data-lyrics-container="true">Fourth</div>"#;
        let lines = parse_genius_html(html);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec!["[Verse]", "First & second", "Third", "Fourth"]
        );
        assert!(lines.iter().all(|line| line.start_ms.is_none()));
    }

    #[test]
    fn removes_genius_contributor_header_from_first_lyric() {
        let html = r#"<div data-lyrics-container="true">3 ContributorsGraduation LyricsI'm not going to graduation<br>I'm not wearing the cap and gown</div>"#;
        let lines = parse_genius_html(html);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec![
                "I'm not going to graduation",
                "I'm not wearing the cap and gown"
            ]
        );
    }

    #[test]
    fn creates_genius_style_slugs() {
        assert_eq!(genius_slug("Arctic Monkeys"), "arctic-monkeys");
        assert_eq!(
            genius_slug("Why'd You Only Call Me?"),
            "whyd-you-only-call-me"
        );
    }

    #[test]
    fn rejects_unexpected_genius_redirects() {
        assert!(is_expected_genius_page(
            &Url::parse("https://genius.com/arctic-monkeys-fluorescent-adolescent-lyrics").unwrap(),
            "arctic-monkeys",
            "fluorescent-adolescent"
        ));
        assert!(!is_expected_genius_page(
            &Url::parse("https://example.com/arctic-monkeys-fluorescent-adolescent-lyrics")
                .unwrap(),
            "arctic-monkeys",
            "fluorescent-adolescent"
        ));
    }

    #[test]
    fn expires_and_bounds_the_session_cache() {
        let mut cache = LyricsCache::default();
        cache.entries.insert(
            "expired".to_string(),
            CacheEntry {
                value: None,
                expires_at: Instant::now() - Duration::from_secs(1),
            },
        );
        cache.order.push_back("expired".to_string());
        assert_eq!(cache.get("expired"), None);

        for index in 0..=CACHE_CAPACITY {
            cache.insert(format!("track-{index}"), None);
        }
        assert_eq!(cache.entries.len(), CACHE_CAPACITY);
        assert!(!cache.entries.contains_key("track-0"));
    }
}
