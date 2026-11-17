//! Room engine: typed model, tool client, sync loop and a UI-independent state reducer.
pub mod client;
pub mod event;
pub mod model;
pub mod state;
pub mod sync;

pub use client::{Auth, RoomClient, SaveOutcome, Sent};
pub use event::{Conn, Event, Transport};
pub use model::{Doc, Message, Participant, Revision, Role, RoomInfo};
pub use state::{Applied, RoomState, mentions};
pub use sync::{Control, Session, SyncOptions, TransportMode, start};
