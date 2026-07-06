// Centralized PostHog event constants

export const AUTH_EVENTS = {
  SIGN_IN_COMPLETED: "auth_sign_in_completed",
  SIGN_IN_FAILED: "auth_sign_in_failed",
  SIGN_UP_COMPLETED: "auth_sign_up_completed",
  SIGN_UP_FAILED: "auth_sign_up_failed",
  SIGN_OUT: "auth_sign_out",
  PASSWORD_RESET_REQUESTED: "auth_password_reset_requested",
  PASSWORD_RESET_COMPLETED: "auth_password_reset_completed",
  DEVICE_AUTHORIZED: "cli_device_authorized",
} as const

export const SANDBOX_EVENTS = {
  CREATED: "sandbox_created",
  PAUSED: "sandbox_paused",
  RESUMED: "sandbox_resumed",
  DELETED: "sandbox_deleted",
  BULK_DELETED: "sandbox_bulk_deleted",
  CONNECT_OPENED: "sandbox_connect_opened",
  TERMINAL_OPENED: "sandbox_terminal_opened",
  PREVIEW_OPENED: "sandbox_preview_opened",
} as const

export const TERMINAL_EVENTS = {
  SESSION_STARTED: "terminal_session_started",
  SESSION_ENDED: "terminal_session_ended",
  RECONNECTED: "terminal_reconnected",
  TAB_OPENED: "terminal_tab_opened",
  TAB_CLOSED: "terminal_tab_closed",
  TAB_RENAMED: "terminal_tab_renamed",
} as const

export const FILE_EVENTS = {
  UPLOAD_SUCCEEDED: "file_upload_succeeded",
  UPLOAD_FAILED: "file_upload_failed",
  DOWNLOAD_SUCCEEDED: "file_download_succeeded",
  DOWNLOAD_FAILED: "file_download_failed",
} as const

export const API_KEY_EVENTS = {
  CREATED: "api_key_created",
  COPIED: "api_key_copied",
  REVOKED: "api_key_revoked",
  BULK_REVOKED: "api_key_bulk_revoked",
} as const

export const SNAPSHOT_EVENTS = {
  DELETED: "snapshot_deleted",
  BULK_DELETED: "snapshot_bulk_deleted",
} as const

export const SECRET_EVENTS = {
  CREATED: "secret_created",
  ROTATED: "secret_rotated",
  DELETED: "secret_deleted",
} as const

export const SETTINGS_EVENTS = {
  PROFILE_UPDATED: "settings_profile_updated",
  PASSWORD_CHANGED: "settings_password_changed",
  ACCOUNT_DELETION_REQUESTED: "settings_account_deletion_requested",
} as const
