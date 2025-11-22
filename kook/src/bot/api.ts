import type { HttpClient } from 'pluxel-plugin-wretch'
import type * as Kook from '../types'
import type {
  BotOnlineStatus,
  DirectMessageGetType,
  IBaseAPIResponse,
  IVoiceInfo,
} from '../types'

/* ------------------------ Core types ------------------------ */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

type JsonLike = Record<string, unknown> | undefined
type RequestPayload = { searchParams?: Record<string, unknown>; json?: JsonLike; body?: BodyInit }

export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; code: number; message: string }
export type Result<T> = Ok<T> | Err

const API_PREFIX = '/api/v3' as const

/* --- minimal local contracts to avoid leaking wretch internals into types --- */
type JsonChain = { json(): Promise<unknown> }
type RequestBuilder = {
  get(): JsonChain
  delete(): JsonChain
  head(): JsonChain
  opts(): JsonChain
  post(b?: BodyInit | JsonLike): JsonChain
  put(b?: BodyInit | JsonLike): JsonChain
  patch(b?: BodyInit | JsonLike): JsonChain
}

/* =========================== AbstractBot =========================== */

export abstract class AbstractBot {
  abstract http: HttpClient

  /** 统一 Result；传输/解析失败也折叠为 { ok:false }。 */
  protected requestResult<T>(
    method: HttpMethod,
    path: string,
    payload?: RequestPayload,
  ): Promise<Result<T>> {
    const sp = cleanParams(payload?.searchParams)
    const url = sp ? appendQuery(API_PREFIX + path, sp) : API_PREFIX + path

    const req = this.http.url(url) as unknown as RequestBuilder
    const body = payload?.body ?? payload?.json

    let rc: JsonChain | null = null
    switch (method) {
      case 'GET': rc = req.get(); break
      case 'DELETE': rc = req.delete(); break
      case 'POST': rc = req.post(body); break
      case 'PUT': rc = req.put(body); break
      case 'PATCH': rc = req.patch(body); break
      case 'HEAD': rc = req.head(); break
      case 'OPTIONS': rc = req.opts(); break
      default: rc = null
    }
    if (!rc) return Promise.resolve({ ok: false, code: -400, message: 'Unsupported HTTP method' })

    return rc
      .json()
      .then((raw) => {
        const res = raw as unknown as IBaseAPIResponse<T>
        return res.code === 0
          ? { ok: true, data: res.data }
          : { ok: false, code: res.code, message: res.message || 'Unexpected Error' }
      })
      .catch((e: unknown) => ({ ok: false, code: normalizeErrCode(e), message: normalizeErrMsg(e) })) as any
  }

  /** 定义期编译：运行期零判断（Result 版本） */
  static defineResult(name: string, method: HttpMethod, path: string) {
    const isQuery = method === 'GET' || method === 'DELETE'
    const fixed = path
    type Dyn = Record<string, (this: AbstractBot, arg?: unknown) => Promise<Result<unknown>>>
    ;(AbstractBot.prototype as unknown as Dyn)[name] = function (this: AbstractBot, arg?: unknown) {
      return this.requestResult<unknown>(
        method,
        fixed,
        isQuery
          ? arg
            ? { searchParams: arg as Record<string, unknown> }
            : undefined
          : { json: arg as JsonLike },
      )
    }
  }

  /* -------------------- Hand-written endpoints -------------------- */

  sendMessage(
    target_id: string,
    content: string,
    options?: {
      type?: Kook.MessageType
      temp_target_id?: string
      quote?: string
      template_id?: string
    },
  ): Promise<Result<Kook.MessageReturn>> {
    const o = options
    return this.requestResult<Kook.MessageReturn>('POST', '/message/create', {
      json: {
        target_id,
        content,
        type: o?.type,
        temp_target_id: o?.temp_target_id,
        quote: o?.quote,
        template_id: o?.template_id,
      },
    })
  }

  private _makeMessageBuilder(
    target_id: string,
    base?: { type?: Kook.MessageType; quote?: string; template_id?: string; temp_target_id?: string },
  ) {
    const defaults = base ? Object.freeze({ ...base }) : undefined
    return (
      content: string,
      ov?: { type?: Kook.MessageType; quote?: string; template_id?: string },
    ): Promise<Result<Kook.MessageReturn>> =>
      this.sendMessage(target_id, content, {
        type: ov?.type ?? defaults?.type,
        quote: ov?.quote ?? defaults?.quote,
        template_id: ov?.template_id ?? defaults?.template_id,
        temp_target_id: defaults?.temp_target_id,
      })
  }

  createTempMessageBuilder(
    target_id: string,
    user_id: string,
    builderOptions?: { type?: Kook.MessageType; quote?: string; template_id?: string },
  ) {
    return this._makeMessageBuilder(target_id, { ...builderOptions, temp_target_id: user_id })
  }

  createMessageBuilder(
    target_id: string,
    builderOptions?: { type?: Kook.MessageType; quote?: string; template_id?: string },
  ) {
    return this._makeMessageBuilder(target_id, builderOptions)
  }

  updateMessage(
    msg_id: string,
    content: string,
    options?: {
      type?: Kook.MessageType.kmarkdown | Kook.MessageType.card
      temp_target_id?: string
      quote?: string
      template_id?: string
    },
  ): Promise<Result<void>> {
    const o = options
    return this.requestResult<void>('POST', '/message/update', {
      json: {
        msg_id,
        content,
        type: o?.type,
        temp_target_id: o?.temp_target_id,
        quote: o?.quote,
        template_id: o?.template_id,
      },
    })
  }

  deleteMessage(msg_id: string): Promise<Result<void>> {
    return this.requestResult<void>('POST', '/message/delete', { json: { msg_id } })
  }

  createAsset(file: Buffer | Blob | string | FormData, name = 'asset'): Promise<Result<string>> {
    const form = toFormData(file, name)
    return this.requestResult<{ url: string }>('POST', '/asset/create', { body: form }).then((r) =>
      r.ok ? { ok: true, data: r.data.url } : r,
    )
  }
}

/* ---------------------- Auto-wired endpoints ---------------------- */

const D = AbstractBot.defineResult

D('getGuildList', 'GET', '/guild/list')
D('getGuildView', 'GET', '/guild/view')
D('getGuildUserList', 'GET', '/guild/user-list')
D('setGuildUserNickname', 'POST', '/guild/nickname')
D('leaveGuild', 'POST', '/guild/leave')
D('kickoutGuildUser', 'POST', '/guild/kickout')
D('getGuildMuteList', 'GET', '/guild-mute/list')
D('createGuildMute', 'POST', '/guild-mute/create')
D('deleteGuildMute', 'POST', '/guild-mute/delete')
D('getGuildBoostHistory', 'GET', '/guild-boost/history')

D('getChannelList', 'GET', '/channel/list')
D('getChannelView', 'GET', '/channel/view')
D('createChannel', 'POST', '/channel/create')
D('updateChannel', 'POST', '/channel/update')
D('deleteChannel', 'POST', '/channel/delete')
D('getChannelUserList', 'GET', '/channel/user-list')
D('kickChannelUser', 'POST', '/channel/kickout')
D('moveChannelUser', 'POST', '/channel/move-user')
D('getChannelRoleIndex', 'GET', '/channel-role/index')
D('syncChannelRole', 'POST', '/channel-role/sync')
D('createChannelRole', 'POST', '/channel-role/create')
D('updateChannelRole', 'POST', '/channel-role/update')
D('deleteChannelRole', 'POST', '/channel-role/delete')

D('getMessageList', 'GET', '/message/list')
D('getMessageView', 'GET', '/message/view')
D('getMessageReactionList', 'GET', '/message/reaction-list')
D('addMessageReaction', 'POST', '/message/add-reaction')
D('deleteMessageReaction', 'POST', '/message/delete-reaction')
D('sendPipeMessage', 'POST', '/message/send-pipemsg')

D('getUserJoinedChannelList', 'GET', '/channel-user/get-joined-channel')

D('getPrivateChatList', 'GET', '/user-chat/list')
D('getPrivateChatView', 'GET', '/user-chat/view')
D('createPrivateChat', 'POST', '/user-chat/create')
D('deletePrivateChat', 'POST', '/user-chat/delete')

D('getDirectMessageList', 'GET', '/direct-message/list')
D('createDirectMessage', 'POST', '/direct-message/create')
D('getDirectMessageView', 'GET', '/direct-message/view')
D('updateDirectMessage', 'POST', '/direct-message/update')
D('deleteDirectMessage', 'POST', '/direct-message/delete')
D('getDirectMessageReactionList', 'GET', '/direct-message/reaction-list')
D('addDirectMessageReaction', 'POST', '/direct-message/add-reaction')
D('deleteDirectMessageReaction', 'POST', '/direct-message/delete-reaction')

D('getGateway', 'GET', '/gateway/index')
D('getToken', 'POST', '/oauth2/token')

D('getUserMe', 'GET', '/user/me')
D('getUserView', 'GET', '/user/view')
D('offline', 'POST', '/user/offline')
D('online', 'POST', '/user/online')
D('getOnlineStatus', 'GET', '/user/get-online-status')

D('joinVoice', 'POST', '/voice/join')
D('listJoinedVoice', 'GET', '/voice/list')
D('leaveVoice', 'POST', '/voice/leave')
D('keepVoiceAlive', 'POST', '/voice/keep-alive')

D('getGuildRoleList', 'GET', '/guild-role/list')
D('createGuildRole', 'POST', '/guild-role/create')
D('updateGuildRole', 'POST', '/guild-role/update')
D('deleteGuildRole', 'POST', '/guild-role/delete')
D('grantGuildRole', 'POST', '/guild-role/grant')
D('revokeGuildRole', 'POST', '/guild-role/revoke')

D('getIntimacy', 'GET', '/intimacy/index')
D('updateIntimacy', 'POST', '/intimacy/update')

D('getGuildEmojiList', 'GET', '/guild-emoji/list')
D('updateGuildEmoji', 'POST', '/guild-emoji/update')
D('deleteGuildEmoji', 'POST', '/guild-emoji/delete')

D('getInviteList', 'GET', '/invite/list')
D('createInvite', 'POST', '/invite/create')
D('deleteInvite', 'POST', '/invite/delete')

D('getBlacklist', 'GET', '/blacklist/list')
D('createBlacklist', 'POST', '/blacklist/create')
D('deleteBlacklist', 'POST', '/blacklist/delete')

D('getGuildBadge', 'GET', '/badge/guild')
D('getGameList', 'GET', '/game')
D('createGame', 'POST', '/game/create')
D('updateGame', 'POST', '/game/update')
D('deleteGame', 'POST', '/game/delete')
D('createGameActivity', 'POST', '/game/activity')
D('deleteGameActivity', 'POST', '/game/delete-activity')

D('getTemplateList', 'GET', '/template/list')
D('createTemplate', 'POST', '/template/create')
D('updateTemplate', 'POST', '/template/update')
D('deleteTemplate', 'POST', '/template/delete')

/* ---------------- Declaration merging for typing (Result) ---------------- */
/* biome-ignore lint/suspicious/noUnsafeDeclarationMerging: intended class+interface merging for dynamic endpoints typing */
export interface AbstractBot {
  // guild
  getGuildList(param?: Kook.Pagination): Promise<Result<Kook.GuildList>>
  getGuildView(param: { guild_id: string }): Promise<Result<Kook.Guild>>
  getGuildUserList(
    param: {
      guild_id: string
    } & Partial<{
      channel_id: string
      search: string
      role_id: number
      mobile_verified: 0 | 1
      active_time: 0 | 1
      joined_at: 0 | 1
      filter_user_id: string
    }> &
      Kook.Pagination,
  ): Promise<Result<Kook.GuildUserList>>
  setGuildUserNickname(param: {
    guild_id: string
    user_id: string
    nickname: string
  }): Promise<Result<void>>
  leaveGuild(param: { guild_id: string }): Promise<Result<void>>
  kickoutGuildUser(param: { guild_id: string; target_id: string }): Promise<Result<void>>
  getGuildMuteList(param: { guild_id: string }): Promise<Result<Kook.GuildMuteList>>
  createGuildMute(param: {
    guild_id: string
    user_id: string
    type: Kook.GuildMute.Type
  }): Promise<Result<void>>
  deleteGuildMute(param: {
    guild_id: string
    user_id: string
    type: Kook.GuildMute.Type
  }): Promise<Result<void>>
  getGuildBoostHistory(param: {
    guild_id: string
    start_time: number
    end_time: number
  }): Promise<Result<Kook.List<Kook.GuildBoost>>>

  // channel
  getChannelList(
    param: {
      guild_id: string
      type?: 1 | 2
      parent_id?: string
    } & Kook.Pagination,
  ): Promise<Result<Kook.List<Kook.Channel>>>
  getChannelView(param: { target_id: string }): Promise<Result<Kook.Channel>>
  createChannel(param: {
    guild_id: string
    name: string
    parent_id?: string
    type?: number
    limit_amount?: number
    voice_quality?: string
    is_category?: 0 | 1
  }): Promise<Result<Kook.Channel>>
  updateChannel(param: {
    channel_id: string
    name?: string
    level?: number
    parent_id?: string
    topic?: string
    slow_mode?:
      | 0
      | 5000
      | 10000
      | 15000
      | 30000
      | 60000
      | 120000
      | 300000
      | 600000
      | 900000
      | 1800000
      | 3600000
      | 7200000
      | 21600000
    limit_amount?: number
    voice_quality?: string
    password?: string
  }): Promise<Result<Kook.Channel>>
  deleteChannel(param: { channel_id: string }): Promise<Result<void>>
  getChannelUserList(param: { channel_id: string }): Promise<Result<Kook.User[]>>
  moveChannelUser(param: {
    target_id: string
    user_ids: string[]
  }): Promise<Result<{ user_ids: string[] }>>
  kickChannelUser(param: { channel_id: string; user_id: string }): Promise<Result<void>>
  getChannelRoleIndex(param: { channel_id: string }): Promise<Result<Kook.ChannelRoleIndex>>
  createChannelRole(param: {
    channel_id: string
    type?: 'user_id'
    value?: string
  }): Promise<Result<Omit<Kook.ChannelRole, 'role_id'>>>
  createChannelRole(param: {
    channel_id: string
    type: 'role_id'
    value?: string
  }): Promise<Result<Omit<Kook.ChannelRole, 'user_id'>>>
  updateChannelRole(param: {
    channel_id: string
    type?: 'user_id'
    value?: string
    allow?: number
    deny?: number
  }): Promise<Result<Omit<Kook.ChannelRole, 'role_id'>>>
  updateChannelRole(param: {
    channel_id: string
    type: 'role_id'
    value?: string
    allow?: number
    deny?: number
  }): Promise<Result<Omit<Kook.ChannelRole, 'user_id'>>>
  syncChannelRole(param: { channel_id: string }): Promise<Result<Kook.ChannelRoleIndex>>
  deleteChannelRole(param: {
    channel_id: string
    type?: 'user_id' | 'role_id'
    value?: string
  }): Promise<Result<void>>

  // message
  getMessageList(
    param: {
      target_id: string
      msg_id?: string
      pin?: 0 | 1
      flag?: 'before' | 'around' | 'after'
    } & Kook.Pagination,
  ): Promise<Result<Kook.List<Kook.Message>>>
  getMessageView(param: { msg_id: string }): Promise<Result<Kook.Message>>
  getMessageReactionList(param: { msg_id: string; emoji: string }): Promise<Result<Kook.User[]>>
  addMessageReaction(param: { msg_id: string; emoji: string }): Promise<Result<void>>
  deleteMessageReaction(param: {
    msg_id: string
    emoji: string
    user_id?: string
  }): Promise<Result<void>>
  sendPipeMessage(
    param: {
      access_token: string
      type?: Kook.MessageType
      target_id?: string
    } & Record<string, unknown>,
  ): Promise<Result<void>>

  // channel-user
  getUserJoinedChannelList(
    param: { guild_id: string; user_id: string } & Kook.Pagination,
  ): Promise<Result<Kook.List<Kook.Channel>>>

  // private chat
  getPrivateChatList(
    param?: Kook.Pagination,
  ): Promise<
    Result<Kook.List<Omit<Kook.PrivateChat, 'is_friend' | 'is_blocked' | 'is_target_blocked'>>>
  >
  getPrivateChatView(param: { chat_code: string }): Promise<Result<Kook.PrivateChat>>
  createPrivateChat(param: { target_id: string }): Promise<Result<Kook.PrivateChat>>
  deletePrivateChat(param: { chat_code: string }): Promise<Result<void>>

  // direct message
  getDirectMessageList(
    param: {
      msg_id?: string
      flag?: 'before' | 'around' | 'after'
    } & DirectMessageGetType &
      Kook.Pagination,
  ): Promise<Result<{ items: Kook.Message[] }>>
  getDirectMessageView(
    param: { chat_code: string; msg_id: string } & Kook.Pagination,
  ): Promise<Result<{ items: Kook.Message[] }>>
  createDirectMessage(
    param: {
      type?: Kook.MessageType
      content: string
      quote?: string
      nonce?: string
      template_id?: string
    } & DirectMessageGetType,
  ): Promise<Result<Kook.MessageReturn>>
  updateDirectMessage(param: {
    msg_id: string
    content: string
    quote?: string
    template_id?: string
  }): Promise<Result<void>>
  deleteDirectMessage(param: { msg_id: string }): Promise<Result<void>>
  getDirectMessageReactionList(param: {
    msg_id: string
    emoji?: string
  }): Promise<Result<Kook.User[]>>
  addDirectMessageReaction(param: {
    msg_id: string
    emoji: string
  }): Promise<Result<void>>
  deleteDirectMessageReaction(param: {
    msg_id: string
    emoji: string
    user_id?: string
  }): Promise<Result<void>>

  // gateway & user
  getGateway(param: { compress?: 0 | 1 }): Promise<Result<{ url: string }>>
  getUserMe(): Promise<Result<Kook.User>>
  getUserView(param: { user_id: string; guild_id?: string }): Promise<Result<Kook.User>>
  offline(): Promise<Result<void>>
  online(): Promise<Result<void>>
  getOnlineStatus(): Promise<Result<BotOnlineStatus>>

  // voice
  joinVoice(param: {
    channel_id: string
    audio_ssrc?: string
    audio_pt?: string
    rtcp_mux?: boolean
    password?: string
  }): Promise<Result<IVoiceInfo>>
  listJoinedVoice(
    param?: Kook.Pagination,
  ): Promise<Result<Kook.List<{ id: string; guild_id: string; parent_id: string; name: string }>>>
  leaveVoice(param: { channel_id: string }): Promise<Result<void>>
  keepVoiceAlive(param: { channel_id: string }): Promise<Result<void>>

  // guild role
  getGuildRoleList(
    param: { guild_id: string } & Kook.Pagination,
  ): Promise<Result<Kook.List<Kook.GuildRole>>>
  createGuildRole(param: {
    name?: string
    guild_id: string
  }): Promise<Result<Kook.GuildRole>>
  updateGuildRole(
    param: { guild_id: string; role_id: number } & Partial<Omit<Kook.GuildRole, 'role_id'>>,
  ): Promise<Result<Kook.GuildRole>>
  deleteGuildRole(param: { guild_id: string; role_id: number }): Promise<Result<void>>
  grantGuildRole(param: {
    guild_id: string
    user_id?: string
    role_id: number
  }): Promise<Result<Kook.GuildRoleReturn>>
  revokeGuildRole(param: {
    guild_id: string
    user_id?: string
    role_id: number
  }): Promise<Result<Kook.GuildRoleReturn>>

  // intimacy
  getIntimacy(param: { user_id: string }): Promise<Result<Kook.Intimacy>>
  updateIntimacy(param: {
    user_id: string
    score?: number
    social_info?: string
    img_id?: string
  }): Promise<Result<void>>

  // emoji
  getGuildEmojiList(param?: Kook.Pagination): Promise<Result<Kook.List<Kook.Emoji>>>
  updateGuildEmoji(param: { name: string; id: string }): Promise<Result<void>>
  deleteGuildEmoji(param: { id: string }): Promise<Result<void>>

  // invite
  getInviteList(
    param: { guild_id?: string; channel_id?: string } & Kook.Pagination,
  ): Promise<Result<Kook.List<Kook.Invite>>>
  createInvite(param: {
    guild_id?: string
    channel_id?: string
    duration?: number
    setting_times?: number
  }): Promise<Result<{ url: string }>>
  deleteInvite(param: {
    url_code: string
    guild_id?: string
    channel_id?: string
  }): Promise<Result<void>>

  // blacklist
  getBlacklist(
    param: { guild_id: string } & Kook.Pagination,
  ): Promise<Result<Kook.List<Kook.BlackList>>>
  createBlacklist(param: {
    guild_id: string
    target_id: string
    remark?: string
    del_msg_days?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  }): Promise<Result<void>>
  deleteBlacklist(param: {
    guild_id: string
    target_id: string
  }): Promise<Result<void>>

  // badge
  getGuildBadge(param: { guild_id: string; style?: 0 | 1 | 2 }): Promise<Result<void>>

  // game
  getGameList(param?: { type?: 0 | 1 | 2 }): Promise<Result<Kook.List<Kook.Game>>>
  createGame(param: { name: string; icon?: string }): Promise<Result<Kook.List<Kook.Game>>>
  updateGame(param: {
    id: number
    name?: string
    icon?: string
  }): Promise<Result<Kook.List<Kook.Game>>>
  deleteGame(param: { id: number }): Promise<Result<void>>
  createGameActivity(param: { data_type: 1; id: number }): Promise<Result<void>>
  createGameActivity(param: {
    data_type: 2
    id: number
    software: 'cloudmusic' | 'qqmusic' | 'kugou'
    singer: string
    music_name: string
  }): Promise<Result<void>>
  deleteGameActivity(param: { data_type: 1 | 2 }): Promise<Result<void>>

  // template
  getTemplateList(param?: Kook.Pagination): Promise<Result<Kook.List<Kook.ITemplate>>>
  createTemplate(
    param: Pick<Kook.ITemplate, 'title' | 'content'> &
      Partial<Pick<Kook.ITemplate, 'type' | 'msgtype' | 'test_data' | 'test_channel'>>,
  ): Promise<Result<Kook.ITemplateReturn>>
  updateTemplate(
    param: Pick<Kook.ITemplate, 'id'> &
      Partial<
        Pick<
          Kook.ITemplate,
          'title' | 'content' | 'type' | 'msgtype' | 'test_data' | 'test_channel'
        >
      >,
  ): Promise<Result<Kook.ITemplateReturn>>
  deleteTemplate(param: Pick<Kook.ITemplate, 'id'>): Promise<Result<void>>
}

/* ----------------------------- Helpers ----------------------------- */

function appendQuery(path: string, params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  let has = false
  for (const k in params) {
    const v = (params as Record<string, unknown>)[k]
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        search.append(k, serializeQueryValue(v[i]))
        has = true
      }
    } else {
      search.append(k, serializeQueryValue(v))
      has = true
    }
  }
  if (!has) return path
  return path + (path.includes('?') ? '&' : '?') + search.toString()
}

function serializeQueryValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function cleanParams(obj: Record<string, unknown> | undefined) {
  if (!obj) return undefined
  let has = false
  const out: Record<string, unknown> = {}
  for (const k in obj) {
    const v = obj[k]
    if (v === undefined) continue
    out[k] = v
    has = true
  }
  return has ? out : undefined
}

function toFormData(file: Buffer | Blob | string | FormData, name: string): FormData {
  if (typeof file === 'string') {
    const u8 =
      typeof Buffer !== 'undefined'
        ? Buffer.from(file, 'base64') // Node
        : Uint8Array.from(atob(file), (c) => c.charCodeAt(0)) // Browser
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
    const fd = new FormData()
    fd.append('file', new Blob([ab], { type: 'application/octet-stream' }), name)
    return fd
  }

  if (isNodeBuffer(file)) {
    const u8 = new Uint8Array(file.buffer, file.byteOffset, file.byteLength)
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
    const fd = new FormData()
    fd.append('file', new Blob([ab], { type: 'application/octet-stream' }), name)
    return fd
  }

  if (file instanceof Blob) {
    const fd = new FormData()
    fd.append('file', file, name)
    return fd
  }

  return file
}

function isNodeBuffer(x: unknown): x is Buffer {
  return typeof Buffer !== 'undefined' && x instanceof Buffer
}

function normalizeErrCode(e: unknown): number {
  const status = (e as { status?: unknown })?.status
  return typeof status === 'number' ? status : -1
}

function normalizeErrMsg(e: unknown): string {
  if (!e) return 'Network Error'
  if (typeof e === 'string') return e
  if (e instanceof Error && e.message) return e.message
  const m = e as { message?: unknown; statusText?: unknown }
  if (typeof m.message === 'string') return m.message
  if (typeof m.statusText === 'string') return m.statusText
  return 'Network Error'
}
