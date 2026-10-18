import { z } from 'zod'
import { hostPortSchema, type HostState } from './host-protocol'
import type { Invite, InviteParseResult } from './invite'
import type { NetworkCheckResult } from './network'
import type { RecentRoom, RecentStatus } from './recent'
import { SCREEN_MODES, type ScreenMode, type ScreenSourcesResult } from './screen'
import type { JoinResult, MediaResponse, RoomClosedEvent, RoomEvent, RoomPreview } from './room'
import { isHotkeyAccelerator, type HotkeyAction, type HotkeyStatus } from './global-hotkeys'
import { isPushToTalkKey, type PushToTalkMode } from './push-to-talk'
import { mediaRequestSchema, peerNameSchema, type MediaRequest } from './signaling'
import { settingsPatchSchema, type Settings, type SettingsPatch } from './settings'
import type { UploadMeasurement } from './upload-capacity'

/** The call, for the tray menu (PLAN #44). */
export interface TrayCallState {
  inCall: boolean
  roomName: string
  muted: boolean
  deafened: boolean
}

export interface AppInfo {
  name: string
  version: string
  platform: string
}

/** Renderer → main request/response channels (`ipcRenderer.invoke`). */
export interface InvokeContract {
  'app:get-info': { args: []; result: AppInfo }
  /** Copies text to the system clipboard (the sandboxed preload has no clipboard module). */
  'app:copy-text': { args: [text: string]; result: null }
  /** Opens the installers page in the browser (fixed URL; the renderer cannot pass one). */
  'app:open-download-page': { args: []; result: null }
  /** A newer release in tolki-releases, if any (PLAN #36); asked once per run. */
  'app:check-update': { args: []; result: { version: string } | null }
  /** Never throws for expected failures: returns `stopped` with `lastError` instead. */
  'host:start': { args: [options: HostStartRequest]; result: HostState }
  'host:stop': { args: []; result: HostState }
  'host:get-state': { args: []; result: HostState }
  /** This installation's certificate fingerprint, for invite links; creates it if needed. */
  'host:get-fingerprint': { args: []; result: string }
  /** Can this computer host? Cached for a few minutes unless `force`. */
  'network:check': { args: [options: NetworkCheckRequest]; result: NetworkCheckResult }
  /** Upload speed via speed.cloudflare.com; `disabled` when turned off in settings. */
  'network:measure-upload': { args: [options: NetworkCheckRequest]; result: UploadMeasurement }
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [patch: SettingsPatch]; result: Settings }
  /** An invite link that arrived before the renderer was ready, if any. */
  'invite:take-pending': { args: []; result: InviteParseResult | null }
  /** Connect to a host and authenticate; replaces any current connection. */
  'room:join': { args: [request: JoinRoomRequest]; result: JoinResult }
  'room:leave': { args: []; result: null }
  /** A mediasoup signalling request to the host of the joined room. */
  'room:request': { args: [request: MediaRequest]; result: MediaResponse }
  /** Room name, number of people and whether a password is needed, before joining. */
  'room:preview': { args: [invite: Invite]; result: RoomPreview }
  'recent:list': { args: []; result: RecentRoom[] }
  /** Light check of every recent room: only the number of people, no authentication. */
  'recent:probe': { args: []; result: Record<string, RecentStatus> }
  'recent:remove': { args: [id: string]; result: RecentRoom[] }
  /** Screens and windows with previews for our picker (PLAN #26). */
  'screen:list-sources': { args: []; result: ScreenSourcesResult }
  /** The source the next getDisplayMedia() gets; false if it is not in the last list. */
  'screen:select': { args: [id: string]; result: boolean }
  /** macOS: the privacy pane where «Запись экрана» is allowed. */
  'screen:open-permission-settings': { args: []; result: null }
  /**
   * Push-to-talk (PLAN #39): hook the key globally while active (in a call, turned on); the
   * answer says how the key reaches the app. `askPermission` lets macOS show its request.
   */
  'ptt:configure': {
    args: [request: { active: boolean; key: string; askPermission: boolean }]
    result: PushToTalkMode
  }
  /** macOS «Универсальный доступ» pane (fixed URL). */
  'ptt:open-permission-settings': { args: []; result: null }
  /** The call as the tray menu shows it (PLAN #44). */
  'tray:update': { args: [state: TrayCallState]; result: null }
  /** Register the user's global hotkeys while active (in a call), PLAN #40. */
  'hotkeys:configure': {
    args: [request: { active: boolean; mute: string; deafen: string }]
    result: Record<HotkeyAction, HotkeyStatus>
  }
}

export interface JoinRoomRequest {
  invite: Invite
  name: string
  /** Typed by the user; the invite's embedded or the saved password is used when absent. */
  password?: string | undefined
  /** Joining from the recent rooms list: lets main use the saved password. */
  recentId?: string | undefined
}

export interface NetworkCheckRequest {
  force?: boolean | undefined
  /** Defaults to DEFAULT_HOST_PORT. */
  port?: number | undefined
}

export interface HostStartRequest {
  /** Defaults to DEFAULT_HOST_PORT. */
  port?: number | undefined
  /** Ask the router to forward the port (PCP / NAT-PMP / UPnP). Defaults to true. */
  portMapping?: boolean | undefined
  roomName?: string | undefined
  /** Empty or absent: no password. */
  password?: string | undefined
  /** How screens are shared in this room; defaults to auto. */
  screenMode?: ScreenMode | undefined
  /** Entry waits for the organizer's «Впустить» (#42); defaults to false. */
  approval?: boolean | undefined
}

/** Main → renderer events (`webContents.send`). */
export interface EventContract {
  'host:state': HostState
  /** The user opened a tolki:// link (already parsed strictly in main). */
  'invite:opened': InviteParseResult
  /** The joined room ended without the user leaving: the host closed it or the link dropped. */
  'room:closed': RoomClosedEvent
  /** Someone joined or left the room, started or stopped sending. */
  'room:event': RoomEvent
  /** The link to the room dropped; main is trying to get back (PLAN #31). */
  'room:reconnecting': null
  /** Back in the room as a new participant: the call starts over with this state. */
  'room:reconnected': Extract<JoinResult, { ok: true }>
  /** The global push-to-talk key went down or up (PLAN #39). */
  'ptt:key': { pressed: boolean }
  /** Entry to the room waits for the organizer's «Впустить» (#42). */
  'room:waiting': null
  /** A global hotkey was pressed (PLAN #40). */
  'hotkeys:pressed': { action: HotkeyAction }
  /** Chosen in the tray menu (PLAN #44). */
  'tray:command': { command: 'mute' | 'deafen' | 'leave' }
}

export type InvokeChannel = keyof InvokeContract
export type EventChannel = keyof EventContract

/** Runtime validation of renderer-supplied arguments, checked in main for every call. */
const inviteSchema = z.strictObject({
  host: z.string(),
  hostKind: z.enum(['ipv4', 'ipv6', 'dns']),
  port: z.number().int(),
  roomId: z.string(),
  fingerprint: z.string(),
  password: z.string().optional(),
})

/** Runtime validation of renderer-supplied arguments, checked in main for every call. */
export const invokeArgsSchemas: {
  [K in InvokeChannel]: z.ZodType<InvokeContract[K]['args']>
} = {
  'app:get-info': z.tuple([]),
  'app:copy-text': z.tuple([z.string().max(4096)]),
  'app:open-download-page': z.tuple([]),
  'app:check-update': z.tuple([]),
  'host:start': z.tuple([
    z.strictObject({
      port: hostPortSchema.optional(),
      portMapping: z.boolean().optional(),
      roomName: z.string().trim().min(1).max(64).optional(),
      password: z.string().max(128).optional(),
      screenMode: z.enum(SCREEN_MODES).optional(),
      approval: z.boolean().optional(),
    }),
  ]),
  'host:stop': z.tuple([]),
  'host:get-state': z.tuple([]),
  'host:get-fingerprint': z.tuple([]),
  'network:check': z.tuple([
    z.strictObject({ force: z.boolean().optional(), port: hostPortSchema.optional() }),
  ]),
  'network:measure-upload': z.tuple([z.strictObject({ force: z.boolean().optional() })]),
  'settings:get': z.tuple([]),
  'settings:update': z.tuple([settingsPatchSchema]),
  'invite:take-pending': z.tuple([]),
  'room:join': z.tuple([
    z.strictObject({
      invite: inviteSchema,
      name: peerNameSchema,
      password: z.string().max(128).optional(),
      recentId: z.string().max(64).optional(),
    }),
  ]),
  'room:leave': z.tuple([]),
  'room:request': z.tuple([mediaRequestSchema]),
  'room:preview': z.tuple([inviteSchema]),
  'recent:list': z.tuple([]),
  'recent:probe': z.tuple([]),
  'recent:remove': z.tuple([z.string().max(64)]),
  'screen:list-sources': z.tuple([]),
  'screen:select': z.tuple([z.string().max(256)]),
  'screen:open-permission-settings': z.tuple([]),
  'ptt:configure': z.tuple([
    z.strictObject({
      active: z.boolean(),
      key: z.string().refine(isPushToTalkKey),
      askPermission: z.boolean(),
    }),
  ]),
  'ptt:open-permission-settings': z.tuple([]),
  'tray:update': z.tuple([
    z.strictObject({
      inCall: z.boolean(),
      roomName: z.string().max(64),
      muted: z.boolean(),
      deafened: z.boolean(),
    }),
  ]),
  'hotkeys:configure': z.tuple([
    z.strictObject({
      active: z.boolean(),
      mute: z.string().refine((v) => v === '' || isHotkeyAccelerator(v)),
      deafen: z.string().refine((v) => v === '' || isHotkeyAccelerator(v)),
    }),
  ]),
}

/** The API the preload script exposes to the renderer as `window.tolki`. */
export interface TolkiApi {
  app: {
    getInfo(): Promise<AppInfo>
    copyText(text: string): Promise<null>
    openDownloadPage(): Promise<null>
    checkUpdate(): Promise<{ version: string } | null>
  }
  host: {
    start(options?: HostStartRequest): Promise<HostState>
    stop(): Promise<HostState>
    getState(): Promise<HostState>
    getFingerprint(): Promise<string>
    /** Returns an unsubscribe function. */
    onState(listener: (state: HostState) => void): () => void
  }
  network: {
    check(options?: NetworkCheckRequest): Promise<NetworkCheckResult>
    measureUpload(options?: NetworkCheckRequest): Promise<UploadMeasurement>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
  }
  room: {
    preview(invite: Invite): Promise<RoomPreview>
    /** Returns an unsubscribe function. */
    onClosed(listener: (event: RoomClosedEvent) => void): () => void
    join(request: JoinRoomRequest): Promise<JoinResult>
    leave(): Promise<null>
    request(request: MediaRequest): Promise<MediaResponse>
    /** Returns an unsubscribe function. */
    onEvent(listener: (event: RoomEvent) => void): () => void
    /** Entry waits for the organizer (#42). Returns an unsubscribe function. */
    onWaiting(listener: () => void): () => void
    /** Returns an unsubscribe function. */
    onReconnecting(listener: () => void): () => void
    /** Returns an unsubscribe function. */
    onReconnected(listener: (result: Extract<JoinResult, { ok: true }>) => void): () => void
  }
  recent: {
    list(): Promise<RecentRoom[]>
    probe(): Promise<Record<string, RecentStatus>>
    remove(id: string): Promise<RecentRoom[]>
  }
  screen: {
    listSources(): Promise<ScreenSourcesResult>
    select(id: string): Promise<boolean>
    openPermissionSettings(): Promise<null>
  }
  ptt: {
    configure(request: {
      active: boolean
      key: string
      askPermission: boolean
    }): Promise<PushToTalkMode>
    openPermissionSettings(): Promise<null>
    /** Returns an unsubscribe function. */
    onKey(listener: (event: { pressed: boolean }) => void): () => void
  }
  tray: {
    update(state: TrayCallState): Promise<null>
    /** Returns an unsubscribe function. */
    onCommand(listener: (event: { command: 'mute' | 'deafen' | 'leave' }) => void): () => void
  }
  hotkeys: {
    configure(request: {
      active: boolean
      mute: string
      deafen: string
    }): Promise<Record<HotkeyAction, HotkeyStatus>>
    /** Returns an unsubscribe function. */
    onPressed(listener: (event: { action: HotkeyAction }) => void): () => void
  }
  invite: {
    takePending(): Promise<InviteParseResult | null>
    /** Returns an unsubscribe function. */
    onOpened(listener: (result: InviteParseResult) => void): () => void
  }
}
