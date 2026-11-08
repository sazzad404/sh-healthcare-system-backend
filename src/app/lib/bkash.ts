import { Result } from "pg";
import config from "../config";
import { radisClient } from "./radis";
import { AppError } from "../utils/appError";
import httpStatus from "http-status";

export const getBkashIdToken = async () => {
  try {
    const IdTokenKey = "bkash:idToken";
    const RefreshTokenKey = "bkash:refreshToken";

    let bkashIdToken = await radisClient.get(IdTokenKey);
    const bkashIdTokenTTL = await radisClient.ttl(IdTokenKey);

    const bkashRefreshToken = await radisClient.get(RefreshTokenKey);
    const bkashRefreshTokenTTl = await radisClient.ttl(RefreshTokenKey);

    if (
      (bkashIdTokenTTL <= 600 || !bkashIdToken) &&
      bkashRefreshToken &&
      bkashRefreshTokenTTl > 600
    ) {
      const refreshTokenResponse = await fetch(
        `${config.bkash_base_url}/tokenized/checkout/token/refresh`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            userName: config.bkash_user_name,
            password: config.bkash_password,
          },
          body: JSON.stringify({
            app_key: config.bkash_app_key,
            app_secret: config.bkash_app_secret,
            refresh_token: bkashRefreshToken,
          }),
        },
      );

      if (!refreshTokenResponse.ok) {
        throw new AppError(
          "Refresh Token failed",
          httpStatus.SERVICE_UNAVAILABLE,
        );
      }

      const bkashRefresTokenResult = await refreshTokenResponse.json();

      bkashIdToken = bkashRefresTokenResult.id_token as string;

      await radisClient.set(IdTokenKey, bkashIdToken, {
        expiration: {
          type: "EX",
          value: 60 * 60,
        },
      });
      return bkashIdToken;
    }
    if (bkashIdTokenTTL > 600) {
      return bkashIdToken;
    }

    const response = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/token/grant`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          userName: config.bkash_user_name,
          password: config.bkash_password,
        },
        body: JSON.stringify({
          app_key: config.bkash_app_key,
          app_secret: config.bkash_app_secret,
        }),
      },
    );

    const result = await response.json();

    if (!response.ok) {
      throw new AppError(
        "Bkash Access Token Grant Failed",
        httpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Bkash id token set

    await radisClient.set(IdTokenKey, result.id_token, {
      expiration: {
        type: "EX",
        value: 60 * 60, // 1 hour
      },
    });

    // Bkash refresh token set
    await radisClient.set(RefreshTokenKey, result.refresh_token, {
      expiration: {
        type: "EX",
        value: 60 * 60 * 24 * 28, // 28 days
      },
    });

    bkashIdToken = result.id_token;

    return bkashIdToken;
  } catch (error: any) {
    throw new AppError(
      error.message,
      httpStatus.SERVICE_UNAVAILABLE,
    );
  }
};
