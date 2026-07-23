type Env = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
};

function required(key: keyof Env): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export const env: Env = {
  NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
};

// T60：GA4 Measurement ID（G-XXXXXXXXXX，公開 ID 非密鑰）。選用——未設時
// analytics 與 cookie banner 一律不渲染，故不走會 throw 的 required()。
// NEXT_PUBLIC_* 需以完整字面靜態引用才會被 Next inline 進 client bundle。
export const gaId: string | undefined = process.env.NEXT_PUBLIC_GA_ID;
