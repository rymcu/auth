import { defu } from 'defu';

import type { Refresh } from '../../types';
import { jsonPointerGet, useTypedConfig } from '../../utils/helper';
import { useAuthFetch } from '../use-auth-fetch';
import { logger } from '../../utils/logger';
import { useAuth as useLocalAuth } from '../local/use-auth';
import { useAuthState } from './use-auth-state';
import { navigateTo, useRuntimeConfig } from '#imports';
import type { SessionData } from '#auth';

/**
 * 请求用户权限数据
 */
const getSession: ReturnType<typeof useLocalAuth>["getSession"] = async (
  getSessionOptions = {}
) => {
  const config = useTypedConfig(useRuntimeConfig(), "refresh");
  const { path, method } = config.endpoints.getSession;
  const { token, tokenExpiredTime, refreshToken, loading, data, lastRefreshedAt, clearToken } = useAuthState();
  if (!token.value && !getSessionOptions.force) {
    return;
  }
  console.log('value: ', token.value, refreshToken.value);
  if (token.value && refreshToken.value) {
    const isTokenExpired = tokenExpiredTime.value === null || Date.now() - tokenExpiredTime.value.getTime() > 1000;
    console.log('isTokenExpired: ', isTokenExpired);
    if (isTokenExpired) {
      await refresh({ refreshToken: refreshToken.value });
      return;
    }
  }

  const headers = new Headers(token.value ? { [config.token.headerName]: token.value } : undefined);

  loading.value = true;

  try {
    const response = await useAuthFetch<Record<string, any>>(path, undefined, method, { headers });

    // 根据 JSON pointer 获取正确的 sessionData
    data.value = jsonPointerGet(response, config.sessionData.sessionPointer) as SessionData;
  } catch (error) {
    // 获取 sessionData 出错需要重置登录状态
    logger.error(error);
    data.value = null;
    clearToken();
  }

  loading.value = false;
  lastRefreshedAt.value = new Date();

  // 获取用户信息失败后可以进行的操作
  const { required = false, callbackUrl, external, onUnauthenticated } = getSessionOptions;

  if (required && data.value === null) {
    if (onUnauthenticated) {
      return onUnauthenticated();
    } else {
      await navigateTo(callbackUrl ?? "/", { external });
    }
  }

  return data.value;
};
/**
 * 登录
 */
const signIn: ReturnType<typeof useLocalAuth>["signIn"] = async (
  credentials,
  signInOptions = {},
  fetchOptions
) => {
  // 1. 获取 refresh 配置
  const config = useTypedConfig(useRuntimeConfig(), "refresh");

  // 2. 发起 signIn 请求
  const { path, method } = config.endpoints.signIn;

  const response = await useAuthFetch(path, credentials, method, fetchOptions);

  // 3. 获取 token
  const expectedToken = jsonPointerGet(response, config.token.signInResponseTokenPointer);

  if (typeof expectedToken !== "string") {
    logger.error(
      `Auth: string token expected, received instead: ${JSON.stringify(
        expectedToken
      )}. Tried to find token at ${config.token.signInResponseTokenPointer} in ${JSON.stringify(
        response
      )}`
    );
    return;
  }

  // 4. 获取 refreshToken
  const expectedRefreshToken = jsonPointerGet(
    response,
    config.refreshToken.signInResponseRefreshTokenPointer
  );

  if (typeof expectedRefreshToken !== "string") {
    logger.error(
      `Auth: string token expected, received instead: ${JSON.stringify(
        expectedRefreshToken
      )}. Tried to find token at ${
        config.refreshToken.signInResponseRefreshTokenPointer
      } in ${JSON.stringify(response)}`
    );
    return;
  }

  // 5. 设置 token 与 refreshToken 并获取 sessionData
  const { setToken, setRefreshToken, setTokenExpiredTime } = useAuthState();

  setToken(expectedToken);
  setTokenExpiredTime(new Date(Date.now() + config.token.maxAgeInSeconds * 1000))
  setRefreshToken(expectedRefreshToken);
  await getSession();

  // 6. 上述成功后是否重定向
  const { redirect = true, callbackUrl, external } = signInOptions;

  if (redirect) {
    return navigateTo(callbackUrl ?? "/", { external });
  }
};

/**
 * 登出
 */
const signOut: ReturnType<typeof useLocalAuth>["signOut"] = async (
  signOutOptions = {},
  fetchOptions
) => {
  // 1. 获取 signOut endpoint 配置
  const config = useTypedConfig(useRuntimeConfig(), "refresh");
  const signOutConfig = config.endpoints.signOut;
  const { token, data, lastRefreshedAt, clearToken, clearRefreshToken } = useAuthState();
  let response;

  // 2. 发起 signOut 请求
  if (signOutConfig) {
    const { path, method } = signOutConfig;
    const headers = new Headers(
      token.value ? { [config.token.headerName]: token.value } : undefined
    );

    response = await useAuthFetch(path, undefined, method, defu(fetchOptions, { headers }));
  }

  // 3. 清理 token, refreshToken, session
  data.value = null;
  lastRefreshedAt.value = null;
  clearToken();
  clearRefreshToken();

  // 4. signOut 之后是否需要重定向到其他地址
  const { redirect = true, callbackUrl, external } = signOutOptions;

  if (redirect) {
    await navigateTo(callbackUrl ?? config.pages.login, { external });
  }

  return response;
};

/**
 * 刷新 token
 */
const refresh: Refresh<Record<string, any>> = async (credentials, fetchOptions) => {
  // 1. 获取 refresh 请求配置
  const config = useTypedConfig(useRuntimeConfig(), "refresh");
  const { path, method } = config.endpoints.refresh;
  const { token, lastRefreshedAt, setToken, setRefreshToken, setTokenExpiredTime } = useAuthState();

  // 2. 发送 refresh 请求
  const headers = new Headers(token.value ? { [config.token.headerName]: token.value } : undefined);

  const response = await useAuthFetch(path, credentials, method, defu(fetchOptions, { headers }));

  // 3. 获取新 token
  const expectedToken = jsonPointerGet(response, config.token.signInResponseTokenPointer);

  if (typeof expectedToken !== "string") {
    logger.error(
      `Auth: string token expected, received instead: ${JSON.stringify(
        expectedToken
      )}. Tried to find token at ${config.token.signInResponseTokenPointer} in ${JSON.stringify(
        response
      )}`
    );
    return;
  }

  // 4. 获取新 refreshToken
  if (!config.refreshOnlyToken) {
    const expectedRefreshToken = jsonPointerGet(
      response,
      config.refreshToken.signInResponseRefreshTokenPointer
    );

    if (typeof expectedRefreshToken !== "string") {
      logger.error(
        `Auth: string token expected, received instead: ${JSON.stringify(
          expectedRefreshToken
        )}. Tried to find token at ${
          config.refreshToken.signInResponseRefreshTokenPointer
        } in ${JSON.stringify(response)}`
      );
      return;
    } else {
      setRefreshToken(expectedRefreshToken);
    }
  }

  // 5. 设置新 token 并更新时间
  setToken(expectedToken);
  setTokenExpiredTime(new Date(Date.now() + config.token.maxAgeInSeconds * 1000))

  await getSession();
  lastRefreshedAt.value = new Date();
};

type UseAuthReturn = ReturnType<typeof useAuthState> &
  ReturnType<typeof useLocalAuth> & {
  refresh: typeof refresh
}

export const useAuth = (): UseAuthReturn => {
  const localAuth = useLocalAuth();

  localAuth.getSession = getSession;
  localAuth.signIn = signIn;
  localAuth.signOut = signOut;

  const state = useAuthState();

  return {
    ...localAuth,
    ...state,
    refresh
  };
};
