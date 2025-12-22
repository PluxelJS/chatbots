import type { HttpClient } from 'pluxel-plugin-wretch'
import type { KookApi, KookApiOptions } from './types'
import { AUTO_ENDPOINTS } from './endpoints'
import { createKookApiWithEndpoints, createKookRequest } from './core'

export function createKookApi(http: HttpClient, options?: KookApiOptions): KookApi {
  return createKookApiWithEndpoints(http, options, AUTO_ENDPOINTS as any)
}

export { createKookRequest }
export * from './core'
export * from './types'
