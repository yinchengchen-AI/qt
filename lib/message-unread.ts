import useSWR, { mutate } from "swr";

const UNREAD_KEY = "/api/messages/unread-count";

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: "include" });
  const j = await r.json();
  return j.data ?? { unreadCount: 0 };
};

export function useUnreadCount() {
  const { data } = useSWR<{ unreadCount: number }>(UNREAD_KEY, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 60_000,
  });
  return data?.unreadCount ?? 0;
}

export function refreshUnread() {
  return mutate(UNREAD_KEY);
}
