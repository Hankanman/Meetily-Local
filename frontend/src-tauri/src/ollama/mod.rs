pub mod client;
pub mod commands;
pub mod metadata;

pub use client::*;
// Don't re-export commands to avoid conflicts - lib.rs will import directly
