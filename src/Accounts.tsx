import { useEffect, useState } from "react";
import {
  Plus,
  LogOut,
  Check,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  UserRound,
  FolderHeart,
  KeyRound,
  QrCode,
  Globe,
  Loader2,
  Pencil,
} from "lucide-react";
import type { Account, Platform } from "./types";
import { Modal, PlatformBadge, platformNames, Empty } from "./ui";
type Props = {
  accounts: Account[];
  onAccounts: (a: Account[]) => void;
  onPlaylists: (p: Platform) => void;
  notify: (s: string, error?: boolean) => void;
};
export default function Accounts({
  accounts,
  onAccounts,
  onPlaylists,
  notify,
}: Props) {
  const [login, setLogin] = useState<Platform | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECTED, ON YOUR TERMS</div>
          <h1>连接你的音乐世界</h1>
          <p>登录常用平台，把自己的歌单带到这里。</p>
        </div>
      </div>
      <div className="account-platforms">
        {(["netease", "qq", "kugou"] as Platform[]).map((p) => (
          <article className={`account-platform ${p}`} key={p}>
            <div className="platform-logo">
              {p === "netease" ? "云" : p === "qq" ? "Q" : "酷"}
            </div>
            <h2>{platformNames[p]}</h2>
            <p>
              {accounts.filter((x) => x.platform === p).length} 个已保存账号
            </p>
            <button className="button secondary" onClick={() => setLogin(p)}>
              <Plus size={16} />
              添加账号
            </button>
          </article>
        ))}
      </div>
      <div className="section-heading">
        <h2>我的账号</h2>
        <span className="subtle">每个平台可切换一个当前账号</span>
      </div>
      {!accounts.length ? (
        <Empty
          icon={<UserRound size={28} />}
          heading="在这里，找回你的收藏"
          description="支持 App 扫码、官方网页登录和 Cookie 导入。"
        />
      ) : (
        <div className="account-list">
          {accounts.map((a) => (
            <article className="account-row" key={a.id}>
              <div className={`avatar ${a.platform}`}>
                <UserRound size={23} />
              </div>
              <div className="account-info">
                <strong>{a.nickname}</strong>
                <div>
                  <PlatformBadge platform={a.platform} />
                  <span>ID {a.uid || "未填写"}</span>
                  {!a.verified && (
                    <span className="muted-tag">凭据已保存 · 未验证</span>
                  )}
                </div>
              </div>
              {a.active ? (
                <span className="active-account">
                  <Check size={13} />
                  当前账号
                </span>
              ) : (
                <button
                  className="text-button"
                  onClick={() =>
                    window.sonora
                      .saveAccount({ activate: true, id: a.id })
                      .then(onAccounts)
                      .catch((e) => notify(e.message, true))
                  }
                >
                  切换使用
                </button>
              )}
              <button
                className="button secondary compact"
                onClick={async () => {
                  if (!a.active)
                    onAccounts(
                      await window.sonora.saveAccount({
                        activate: true,
                        id: a.id,
                      }),
                    );
                  onPlaylists(a.platform);
                }}
              >
                <FolderHeart size={15} />
                我的歌单
              </button>
              <button
                className="icon-button"
                title="修改昵称或用户 ID"
                aria-label="修改账号信息"
                onClick={() => setEditing(a)}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-button"
                title="删除本机登录凭据"
                aria-label="退出账号"
                onClick={() =>
                  window.sonora
                    .logout(a.id)
                    .then(onAccounts)
                    .catch((e) => notify(e.message, true))
                }
              >
                <LogOut size={17} />
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="privacy-note">
        <ShieldCheck size={21} />
        <div>
          <strong>你的账号，只留在你的电脑</strong>
          <p>
            凭据通过 Windows 系统加密保存。公共备用音源不会收到账号
            Cookie；自建服务需在接口设置中单独启用凭据传递。
          </p>
        </div>
      </div>
      {login && (
        <LoginModal
          platform={login}
          onClose={() => setLogin(null)}
          onAccounts={(a) => {
            onAccounts(a);
            setLogin(null);
            notify("账号已保存");
          }}
          notify={notify}
        />
      )}
      {editing && (
        <Modal
          title="账号信息"
          subtitle="用户 ID 用于读取这个账号的个人歌单"
          onClose={() => setEditing(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                onAccounts(
                  await window.sonora.saveAccount({
                    updateDetails: true,
                    id: editing.id,
                    uid: editing.uid,
                    nickname: editing.nickname,
                  }),
                );
                setEditing(null);
                notify("账号信息已更新");
              } catch (e) {
                notify((e as Error).message, true);
              }
            }}
          >
            <label>
              账号昵称
              <input
                value={editing.nickname}
                onChange={(e) =>
                  setEditing({ ...editing, nickname: e.target.value })
                }
              />
            </label>
            <label>
              用户 ID
              <input
                value={editing.uid}
                onChange={(e) =>
                  setEditing({ ...editing, uid: e.target.value })
                }
              />
            </label>
            <p className="form-help">
              从平台个人主页链接中获取用户
              ID。此操作不会修改已加密保存的登录凭据。
            </p>
            <button className="button primary" type="submit">
              保存账号信息
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function LoginModal({
  platform,
  onClose,
  onAccounts,
  notify,
}: {
  platform: Platform;
  onClose: () => void;
  onAccounts: (a: Account[]) => void;
  notify: Props["notify"];
}) {
  const [tab, setTab] = useState<"qr" | "web" | "cookie">("qr");
  const [image, setImage] = useState("");
  const [message, setMessage] = useState("正在获取二维码…");
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cookie, setCookie] = useState("");
  const [uid, setUid] = useState("");
  const [nickname, setNickname] = useState("");
  const [show, setShow] = useState(false);
  const [webOpened, setWebOpened] = useState(false);
  useEffect(() => {
    if (tab !== "qr") return;
    let alive = true,
      timer: ReturnType<typeof setTimeout>,
      sid: string | undefined;
    setImage("");
    setMessage("正在获取二维码…");
    const check = async () => {
      try {
        const v = await window.sonora.auth(platform, "check", sid);
        if (!alive) return;
        setMessage(v.message);
        if (v.done && v.accounts) {
          onAccounts(v.accounts);
          return;
        }
        timer = setTimeout(check, 3000);
      } catch (e) {
        if (alive) setMessage((e as Error).message);
      }
    };
    window.sonora
      .auth(platform, "create")
      .then((v) => {
        sid = v.sessionId;
        if (!alive) {
          if (sid) window.sonora.auth(platform, "cancel", sid).catch(() => {});
          return;
        }
        setImage(v.image || "");
        setMessage(v.message);
        timer = setTimeout(check, 3000);
      })
      .catch((e) => alive && setMessage(e.message));
    return () => {
      alive = false;
      clearTimeout(timer);
      if (sid) window.sonora.auth(platform, "cancel", sid).catch(() => {});
    };
  }, [platform, tab, nonce]);
  const save = async () => {
    setBusy(true);
    try {
      onAccounts(
        await window.sonora.saveAccount({ platform, cookie, uid, nickname }),
      );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`登录${platformNames[platform]}`}
      subtitle="选择适合你的登录方式"
      onClose={onClose}
    >
      <div className="segmented login-tabs">
        {(
          [
            ["qr", "App 扫码", QrCode],
            ["web", "网页登录", Globe],
            ["cookie", "Cookie 导入", KeyRound],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
            key={key}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {tab === "qr" ? (
        <div className="qr-box">
          <div className="qr-image">
            {image ? (
              <img src={image} alt="平台登录二维码" />
            ) : (
              <Loader2 size={30} className="spin" />
            )}
          </div>
          <p>{message.replace(/Error invoking remote method[^:]*:/, "")}</p>
          <button
            className="text-button"
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw size={15} />
            刷新二维码
          </button>
          <span className="subtle">
            使用对应平台手机 App 扫码，并在手机上确认登录
          </span>
        </div>
      ) : tab === "web" ? (
        <div className="web-login">
          <div className="empty-icon">
            <Globe size={30} />
          </div>
          <h3>在官方页面完成登录</h3>
          <p>将打开独立的官方登录窗口。完成后回到这里读取登录态。</p>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await window.sonora.openLogin(platform);
                setWebOpened(true);
              } catch (e) {
                notify((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ExternalLink size={16} />
            打开官方页面
          </button>
          {webOpened && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await window.sonora.openLogin(platform, true);
                  if (result.accounts) onAccounts(result.accounts);
                } catch (e) {
                  notify((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              我已完成登录，读取登录态
            </button>
          )}
        </div>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label>
            Cookie{" "}
            <button
              type="button"
              className="inline-link"
              onClick={() => setShow(!show)}
            >
              {show ? "隐藏" : "显示"}
            </button>
            <textarea
              required
              autoComplete="off"
              spellCheck={false}
              className={show ? "" : "masked"}
              rows={4}
              placeholder={
                platform === "netease"
                  ? "MUSIC_U=…; __csrf=…"
                  : platform === "qq"
                    ? "uin=…; qqmusic_key=…"
                    : "token=…; userid=…"
              }
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              用户 ID
              <input
                placeholder="用于读取个人歌单"
                value={uid}
                onChange={(e) => setUid(e.target.value)}
              />
            </label>
            <label>
              账号昵称（可选）
              <input
                placeholder="给这个账号取个名字"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
          </div>
          <p className="form-help">
            从浏览器开发者工具中复制你自己的平台
            Cookie。平台可能分别管理网页登录与播放凭据，导入后仍需具备相应歌曲权限。
          </p>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !cookie.trim()}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ShieldCheck size={16} />
            )}
            加密保存到本机
          </button>
        </form>
      )}
    </Modal>
  );
}
