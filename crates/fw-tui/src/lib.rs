//! Terminal UI (filled in below).
use fw_core::{Error, Result};
use fw_room::{RoomClient, SyncOptions};

pub struct RoomLaunch {
    pub client: RoomClient,
    pub sync: SyncOptions,
    pub mouse: bool,
    pub owner_admin_key: Option<String>,
    pub vault_link: Option<String>,
}

pub async fn run_room(_launch: RoomLaunch) -> Result<()> {
    Err(Error::other("The room panel is not available in this build yet."))
}
