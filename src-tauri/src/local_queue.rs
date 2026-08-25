use serde::{Deserialize, Serialize};
use serde_json::Value;

const QUEUE_VERSION: u8 = 1;
const MAX_QUEUE_ITEMS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: u64,
    pub track: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub items: Vec<QueueEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct QueueFile {
    version: u8,
    next_id: u64,
    items: Vec<QueueEntry>,
}

impl Default for QueueFile {
    fn default() -> Self {
        Self {
            version: QUEUE_VERSION,
            next_id: 1,
            items: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct LocalQueue {
    file: QueueFile,
}

impl LocalQueue {
    pub fn load() -> Self {
        let Some(path) = queue_path() else {
            return Self::default();
        };
        Self::load_from(&path)
    }

    fn load_from(path: &std::path::Path) -> Self {
        let Ok(content) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        let Ok(mut file) = serde_json::from_str::<QueueFile>(&content) else {
            return Self::default();
        };
        if file.version != QUEUE_VERSION {
            return Self::default();
        }
        file.items.truncate(MAX_QUEUE_ITEMS);
        let minimum_next = file
            .items
            .iter()
            .map(|entry| entry.id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        file.next_id = file.next_id.max(minimum_next).max(1);
        Self { file }
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot {
            items: self.file.items.clone(),
        }
    }

    pub fn push(&mut self, track: Value) -> Result<QueueEntry, String> {
        if self.file.items.len() >= MAX_QUEUE_ITEMS {
            return Err(format!("The Spotagooey queue is limited to {MAX_QUEUE_ITEMS} songs"));
        }
        let mut next = self.file.clone();
        let entry = QueueEntry {
            id: next.next_id,
            track,
        };
        next.next_id = next.next_id.saturating_add(1).max(1);
        next.items.push(entry.clone());
        self.commit(next)?;
        Ok(entry)
    }

    pub fn remove(&mut self, id: u64) -> Result<(), String> {
        let mut next = self.file.clone();
        let index = next
            .items
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| "That queue entry no longer exists".to_string())?;
        next.items.remove(index);
        self.commit(next)
    }

    pub fn move_to(&mut self, id: u64, to_index: usize) -> Result<(), String> {
        let mut next = self.file.clone();
        let from_index = next
            .items
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| "That queue entry no longer exists".to_string())?;
        if next.items.len() < 2 {
            return Ok(());
        }
        let entry = next.items.remove(from_index);
        let target = to_index.min(next.items.len());
        next.items.insert(target, entry);
        self.commit(next)
    }

    pub fn clear(&mut self) -> Result<(), String> {
        let mut next = self.file.clone();
        next.items.clear();
        self.commit(next)
    }

    pub fn first(&self) -> Option<QueueEntry> {
        self.file.items.first().cloned()
    }

    pub fn remove_if_first(&mut self, id: u64) -> Result<bool, String> {
        if self.file.items.first().map(|entry| entry.id) != Some(id) {
            return Ok(false);
        }
        let mut next = self.file.clone();
        next.items.remove(0);
        self.commit(next)?;
        Ok(true)
    }

    fn commit(&mut self, next: QueueFile) -> Result<(), String> {
        Self::persist(&next)?;
        self.file = next;
        Ok(())
    }

    fn persist(file: &QueueFile) -> Result<(), String> {
        let path = queue_path().ok_or_else(|| "could not resolve config directory".to_string())?;
        Self::persist_to(&path, file)
    }

    fn persist_to(path: &std::path::Path, file: &QueueFile) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| "invalid queue path".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create queue directory: {error}"))?;
        let temporary = parent.join("queue.json.tmp");
        let content = serde_json::to_vec_pretty(file)
            .map_err(|error| format!("failed to serialize queue: {error}"))?;
        std::fs::write(&temporary, content)
            .map_err(|error| format!("failed to write queue: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                &temporary,
                std::fs::Permissions::from_mode(0o600),
            );
        }
        match std::fs::rename(&temporary, path) {
            Ok(()) => Ok(()),
            Err(error) => {
                #[cfg(target_os = "windows")]
                if path.exists() {
                    std::fs::remove_file(path)
                        .map_err(|remove| format!("failed to replace queue: {remove}"))?;
                    return std::fs::rename(&temporary, path)
                        .map_err(|rename| format!("failed to save queue: {rename}"));
                }
                Err(format!("failed to save queue: {error}"))
            }
        }
    }
}

pub fn queue_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|directory| directory.join("spotagooey").join("queue.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_queue() -> LocalQueue {
        LocalQueue::default()
    }

    #[test]
    fn stable_ids_allow_duplicates_to_be_edited_independently() {
        let mut queue = memory_queue();
        let first = QueueEntry { id: 1, track: serde_json::json!({ "uri": "spotify:track:a" }) };
        let second = QueueEntry { id: 2, track: first.track.clone() };
        queue.file.items = vec![first, second];
        queue.file.next_id = 3;

        queue.file.items.remove(0);

        assert_eq!(queue.file.items[0].id, 2);
    }

    #[test]
    fn moving_an_entry_preserves_its_identity() {
        let mut queue = memory_queue();
        queue.file.items = (1..=3)
            .map(|id| QueueEntry { id, track: serde_json::json!({ "id": id }) })
            .collect();

        let entry = queue.file.items.remove(0);
        queue.file.items.insert(2, entry);

        assert_eq!(queue.file.items.iter().map(|entry| entry.id).collect::<Vec<_>>(), vec![2, 3, 1]);
    }

    #[test]
    fn queue_file_round_trips_order_and_ids() {
        let directory = std::env::temp_dir().join(format!(
            "spotagooey-queue-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = directory.join("queue.json");
        let file = QueueFile {
            version: QUEUE_VERSION,
            next_id: 8,
            items: vec![QueueEntry {
                id: 7,
                track: serde_json::json!({ "uri": "spotify:track:abc" }),
            }],
        };

        LocalQueue::persist_to(&path, &file).unwrap();
        let restored = LocalQueue::load_from(&path);

        assert_eq!(restored.file.next_id, 8);
        assert_eq!(restored.file.items[0].id, 7);
        assert_eq!(restored.file.items[0].track["uri"], "spotify:track:abc");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
