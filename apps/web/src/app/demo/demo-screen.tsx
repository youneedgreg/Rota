"use client";

import type { CircleView } from "@rota/records";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { loadCircle, rememberCircle, replaceMemberSecret, savedMemberSecret } from "@/lib/circles";
import { demoLoginsAllowed, parseDemoLogin } from "@/lib/demo";
import { useT } from "@/lib/lang";
import { button } from "@/lib/ui";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function DemoScreen() {
  const fragment = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => null);
  const saved = useSyncExternalStore(subscribeHash, savedMemberSecret, () => null);
  const [view, setView] = useState<CircleView | null | undefined>(undefined);
  const [relayError, setRelayError] = useState(false);
  const { t } = useT();
  const router = useRouter();

  const allowed = fragment !== null && demoLoginsAllowed();
  const login = fragment ? parseDemoLogin(fragment) : null;

  useEffect(() => {
    if (!allowed || !login) return;
    let live = true;
    loadCircle(login.invite)
      .then((next) => live && setView(next))
      .catch(() => live && setRelayError(true));
    return () => {
      live = false;
    };
    // The login is derived from the fragment; reload only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, fragment]);

  const header = (
    <header className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">{t("demo.title")}</h1>
      <p className="leading-7 text-muted">{t("demo.intro")}</p>
    </header>
  );

  const page = (body: ReactNode) => (
    <>
      {header}
      {body}
    </>
  );
  const alert = (text: string) => page(<p role="alert">{text}</p>);

  if (fragment === null) return <p>{t("common.loading")}</p>;
  if (!demoLoginsAllowed()) return alert(t("demo.localOnly"));
  if (!login) return alert(t("demo.badLink"));
  if (relayError) return alert(t("circle.relayError"));
  if (view === undefined) return page(<p>{t("circle.loading")}</p>);
  if (view === null) return alert(t("circle.badInvite"));

  const member = view.members.find((m) => m.pubkey === login.pubkey);
  if (!member) return alert(t("demo.notMember"));

  const replacing = saved !== null && saved !== login.secret;

  function use() {
    if (!login || !view) return;
    replaceMemberSecret(login.secret);
    rememberCircle(login.invite, view.draft.name);
    router.push(`/circle#${login.invite}`);
  }

  return page(
    <>
      <p className="rounded-lg border border-line p-3 leading-7">{t("demo.public")}</p>
      <p className="leading-7">{t("demo.as", { name: member.name, circle: view.draft.name })}</p>
      {replacing && (
        <p role="alert" className="rounded-lg border border-bad/50 bg-bad/10 p-3 text-bad leading-7">
          {t("demo.replace")}
        </p>
      )}
      <button type="button" className={button} onClick={use}>
        {t("demo.use")}
      </button>
    </>,
  );
}
