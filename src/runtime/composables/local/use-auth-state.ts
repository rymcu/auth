import { type ComputedRef, type Ref, computed, watch } from 'vue'

import { useCommonAuthState } from '../use-common-auth-state'
import { useTypedConfig } from '../../utils/helper'
import type { SessionData } from '#auth'
import { useCookie, useRuntimeConfig, useState } from '#imports'

type UseAuthStateReturn = {
  token: ComputedRef<string | null>
  setToken: (value: string | null) => void
  clearToken: () => void
  tokenExpiredTime: Ref<Date | null>,
  setTokenExpiredTime: (value: Date | null) => void
} & ReturnType<typeof useCommonAuthState<SessionData>>

export const useAuthState = (): UseAuthStateReturn => {
  const config = useTypedConfig(useRuntimeConfig(), 'local')

  const commonAuthState = useCommonAuthState<SessionData>()

  const _tokenCookie = useCookie<string | null>('auth:token', {
    default: () => null,
    maxAge: config.token.maxAgeInSeconds,
    sameSite: config.token.sameSiteAttribute,
    secure: config.token.sameSiteAttribute === 'none',
  })

  // useCookie 的更新机制会延迟
  // 这里需要创建一个响应式变量同步
  /** token global state */
  const rawToken = useState('auth:raw-token', () => _tokenCookie.value)

  watch(rawToken, (value) => {
    _tokenCookie.value = value
  })

  const token = computed(() => {
    if (rawToken.value === null) return null
    return config.token.type.length > 0 ? `${config.token.type} ${rawToken.value}` : rawToken.value
  })

  const tokenExpiredTime = useState('auth:token-expired-time', () => {
    if (rawToken.value === null) return null
    return new Date(Date.now() + config.token.maxAgeInSeconds * 1000)
  })

  const setToken = (value: string | null) => {
    rawToken.value = value
  }

  const setTokenExpiredTime = (value: Date | null) => {
    tokenExpiredTime.value = value;
  }

  const clearToken = () => {
    setToken(null)
    setTokenExpiredTime(null)
  }

  return {
    ...commonAuthState,
    token,
    setToken,
    clearToken,
    tokenExpiredTime,
    setTokenExpiredTime,
  }
}
