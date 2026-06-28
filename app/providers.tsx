"use client";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "swr";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SWRConfig
        value={{
          fetcher: (url: string) =>
            fetch(url, { credentials: "include" }).then(async (r) => {
              const j = await r.json();
              if (j && typeof j === "object" && "code" in j && j.code !== 0) {
                throw Object.assign(new Error(j.message ?? "请求失败"), { info: j });
              }
              return j.data;
            }),
          shouldRetryOnError: false,
          revalidateOnFocus: false
        }}
      >
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}
