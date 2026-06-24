// 基于 APP_ENC_KEY_HEX 的 AES-256-GCM 字段级加密工具
// 用于存储身份证、银行卡、社保/公积金账号等敏感信息。
// 注意：加密后无法按原文做 SQL 查询/索引；仅用于安全落库与解密读取。
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const CIPHER_PREFIX = "enc:";

function getKey(): Buffer {
  // APP_ENC_KEY_HEX 已由 env.ts 校验为 64 位 hex（32 字节）
  return Buffer.from(env.APP_ENC_KEY_HEX, "hex");
}

/**
 * 加密明文。返回格式：enc:base64(salt + iv + authTag + ciphertext)
 * salt 用于在密钥变更场景下保持旧数据可解密（本实现仅做格式预留，实际密钥来自 env）。
 */
export function encrypt(plainText: string): string {
  if (!plainText) return plainText;
  const key = getKey();
  // salt 预留：若后续需要基于密码派生密钥时可使用；当前密钥来自 env，salt 仅作为密文前缀保留
  const _salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([_salt, iv, authTag, encrypted]);
  return `${CIPHER_PREFIX}${combined.toString("base64")}`;
}

/**
 * 解密。
 * - 以 "enc:" 开头的输入视为密文；解密失败返回 null，避免被篡改后降级为明文。
 * - 非 "enc:" 开头的输入视为旧明文数据，直接返回原值（向后兼容）。
 */
export function decrypt(cipherText: string | null | undefined): string | null {
  if (!cipherText) return cipherText ?? null;
  if (!cipherText.startsWith(CIPHER_PREFIX)) {
    // 无前缀：旧明文数据或空值
    return cipherText;
  }
  const payload = cipherText.slice(CIPHER_PREFIX.length);
  try {
    const combined = Buffer.from(payload, "base64");
    if (combined.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      return null;
    }
    const _salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const key = getKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * 用于测试环境生成固定密钥的辅助函数；生产环境应通过 env 注入。
 */
export function deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}
