import "dotenv/config";

export function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`필수 환경 변수 ${name}이(가) 없습니다. .env 파일을 확인하세요.`);
  }

  return value;
}

export function optionalEnv(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export function positiveNumberEnv(name, fallback) {
  const rawValue = optionalEnv(name);

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name}은(는) 0보다 큰 숫자여야 합니다.`);
  }

  return value;
}
