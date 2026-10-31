import { useEffect, useState } from "react";
import ResolverPriority from "./ResolverPriority";
import {
  FolderOpen,
  SlidersHorizontal,
  Radio,
  ChevronDown,
  Save,
  RefreshCw,
  Activity,
  Code2,
  ShieldCheck,
  Download,
  Loader2,
} from "lucide-react";
import type { Settings as SettingsType, Provider, Platform } from "./types";
import { Toggle, platformNames, qualityNames } from "./ui";
export default function Settings({
  settings,
  version,
  onTools,
  onSettings,
  onProviders,
  notify,
}: {
  settings: SettingsType;
  version: string;
  onTools: (tab: string) => void;
  onSettings: (s: SettingsType) => void;
  onProviders: (p: Provider[]) => void;
  notify: (s: string, error?: boolean) => void;
}) {
  const [config, setConfig] = useState<any>(null),
    [advanced, setAdvanced] = useState(false),
    [json, setJson] = useState(""),
    [saving, setSaving] = useState(false),
    [testing, setTesting] = useState(""),
    [testResults, setTestResults] = useState<
      Record<string, { ok: boolean; message: string }>
    >({});
  useEffect(() => {
    window.sonora
      .profiles()
      .then((r) => {
        setConfig(r.config);
        setJson(JSON.stringify(r.config, null, 2));
      })
      .catch((e) => notify(e.message, true));
  }, []);
  const change = (p: Partial<SettingsType>) =>
    window.sonora
      .saveSettings(p)
      .then(onSettings)
      .catch((e) => notify(e.message, true));
  const update = (id: string, patch: any) =>
    setConfig({
      ...config,
      platforms: config.platforms.map((p: any) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    });
  const save = async (value: any) => {
    setSaving(true);
    try {
      const next = typeof value === "string" ? JSON.parse(value) : value;
      onProviders(await window.sonora.saveProfiles(next));
      const saved = await window.sonora.profiles();
      setConfig(saved.config);
      setJson(JSON.stringify(saved.config, null, 2));
      notify("接口配置已生效");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE IT YOURS</div>
          <h1>偏好与音源</h1>
          <p>让每一次聆听，都顺手一点。</p>
        </div>
      </div>
      <section className="settings-section">
        <div className="settings-title">
          <SlidersHorizontal size={20} />
          <h2>聆听与下载</h2>
        </div>
        <div className="setting-row">
          <div>
            <strong>下载目录</strong>
            <p className="path-text">{settings.downloadDir}</p>
          </div>
          <button
            className="button secondary"
            onClick={async () => {
              const p = await window.sonora.chooseDirectory();
              if (p) change({ downloadDir: p });
            }}
          >
            <FolderOpen size={16} />
            更改目录
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>默认音质</strong>
            <p>按账号权益与音源实际支持情况获取</p>
          </div>
          <select
            value={settings.quality}
            onChange={(e) =>
              change({ quality: e.target.value as SettingsType["quality"] })
            }
          >
            {Object.entries(qualityNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>同时下载</strong>
            <p>适当降低并发可减少接口限流</p>
          </div>
          <select
            value={settings.concurrency}
            onChange={(e) => change({ concurrency: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} 个任务
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>信息密度</strong>
            <p>紧凑模式减少顶部留白，为音乐列表保留更多空间</p>
          </div>
          <select
            aria-label="信息密度"
            value={settings.density}
            onChange={(e) =>
              change({ density: e.target.value as SettingsType["density"] })
            }
          >
            <option value="compact">紧凑</option>
            <option value="comfortable">舒适</option>
          </select>
        </div>
        {[
          [
            "autoMetadata",
            "自动匹配并写入标签",
            "下载后按原平台歌曲 ID 获取元数据与封面，写入音频后加入本地音乐库",
          ],
          [
            "autoLyrics",
            "下载时内嵌歌词",
            "将所选格式的歌词写入音频，不生成外部歌词文件",
          ],
          [
            "saveTranslation",
            "合并翻译歌词",
            "将翻译与原文按相同时间戳合并，写入同一内嵌歌词标签",
          ],
          [
            "groupByPlatform",
            "按平台整理文件夹",
            "分别保存到网易云、QQ 音乐、酷狗目录",
          ],
        ].map(([key, title, desc]) => (
          <div className="setting-row" key={key}>
            <div>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
            <Toggle
              checked={Boolean(settings[key as keyof SettingsType])}
              onChange={(v) => change({ [key]: v })}
              label={title}
            />
          </div>
        ))}
        <div className="setting-row">
          <div>
            <strong>歌词保存格式</strong>
            <p>自动模式优先使用真实逐字时间，无逐字信息时保存逐行 LRC</p>
          </div>
          <select
            aria-label="默认歌词格式"
            value={settings.lyricFormat}
            onChange={(e) =>
              change({
                lyricFormat: e.target.value as SettingsType["lyricFormat"],
              })
            }
          >
            <option value="auto">自动（优先逐字）</option>
            <option value="lrc">逐行 LRC</option>
            <option value="elrc">逐字 LRC</option>
            <option value="ttml">TTML</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>歌词来源</strong>
            <p>AMLL 社区库按平台歌曲 ID 查找，收录范围有限</p>
          </div>
          <select
            aria-label="歌词来源"
            value={settings.lyricSource}
            onChange={(e) =>
              change({
                lyricSource: e.target.value as SettingsType["lyricSource"],
              })
            }
          >
            <option value="auto">自动（平台 / AMLL 补充）</option>
            <option value="platform">仅平台接口</option>
            <option value="amll">仅 AMLL 社区库</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>界面外观</strong>
            <p>安静的浅色，或沉浸的深色</p>
          </div>
          <select
            value={settings.theme}
            aria-label="界面外观"
            onChange={(e) =>
              change({ theme: e.target.value as SettingsType["theme"] })
            }
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-title">
          <Radio size={20} />
          <h2>平台接口</h2>
          <span>修改后点击保存</span>
        </div>
        <p className="settings-intro">
          留空使用应用内置引擎。可填写兼容的自建 API
          地址，以便独立升级服务；每个平台的路由、参数与字段映射也可以在高级配置中修改。
        </p>
        {config?.platforms.map((p: any) => (
          <div className="provider-setting" key={p.id}>
            <div className="provider-setting-top">
              <strong>
                <span className={`platform-dot ${p.id}`} />
                {platformNames[p.id]}
              </strong>
              <Toggle
                checked={p.enabled}
                onChange={(enabled) => update(p.id, { enabled })}
                label={`启用${p.name}`}
              />
            </div>
            <div className="endpoint-row">
              <input
                aria-label={`${p.name}接口地址`}
                placeholder="内置引擎（可填写 http://127.0.0.1:3000）"
                value={p.baseUrl}
                onChange={(e) => update(p.id, { baseUrl: e.target.value })}
              />
              <button
                className="button secondary compact"
                disabled={!!testing}
                onClick={async () => {
                  setTesting(p.id);
                  try {
                    const r = await window.sonora.testProvider(p.id);
                    setTestResults((s) => ({
                      ...s,
                      [p.id]: {
                        ok: r.ok,
                        message: `${r.message} · ${r.latency}ms`,
                      },
                    }));
                  } catch (e) {
                    setTestResults((s) => ({
                      ...s,
                      [p.id]: { ok: false, message: (e as Error).message },
                    }));
                  } finally {
                    setTesting("");
                  }
                }}
              >
                {testing === p.id ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Activity size={15} />
                )}
                测试已保存配置
              </button>
            </div>
            {p.baseUrl && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.trustRemoteCredentials}
                  onChange={(e) =>
                    update(p.id, { trustRemoteCredentials: e.target.checked })
                  }
                />
                允许向此地址发送账号 Cookie（仅用于你信任的服务）
              </label>
            )}
            {testResults[p.id] && (
              <p
                className={`test-message ${testResults[p.id].ok ? "ok" : "bad"}`}
              >
                {testResults[p.id].message}
              </p>
            )}
          </div>
        ))}
        <button
          className="button primary"
          disabled={!config || saving}
          onClick={() => save(config)}
        >
          <Save size={16} />
          保存平台配置
        </button>
      </section>
      <section className="settings-section">
        <div className="settings-title">
          <ShieldCheck size={20} />
          <h2>备用取链服务</h2>
        </div>
        <div className="setting-row">
          <div>
            <strong>使用的音源</strong>
            <p>
              手动选择后直接使用该服务；公共接口不接收你的登录凭据，歌曲和音质以实际返回为准。
            </p>
          </div>
          <select
            aria-label="使用的音源"
            value={settings.preferredResolver}
            onChange={(e) => change({ preferredResolver: e.target.value })}
          >
            <option value="auto">自动（内置优先 / 备用）</option>
            <option value="builtin">仅内置平台接口</option>
            {config?.resolvers.map((r: any) => (
              <option key={r.id} value={r.id} disabled={!r.enabled}>
                {r.name}
                {!r.enabled ? "（未启用）" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>启用公共备用音源</strong>
            <p>内置接口取链失败时，按配置顺序尝试。不会发送你的账号 Cookie。</p>
          </div>
          <Toggle
            checked={settings.usePublicFallback}
            onChange={(v) => change({ usePublicFallback: v })}
            label="启用公共备用音源"
          />
        </div>
        {config?.resolvers.map((r: any) => (
          <div className="resolver-row" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <span>
                {r.platforms.map((p: string) => platformNames[p]).join(" / ")}
                {r.strictMatch ? " · 按名称匹配，可能更换版本" : ""}
              </span>
            </div>
            <Toggle
              checked={r.enabled}
              onChange={(v) =>
                setConfig({
                  ...config,
                  resolvers: config.resolvers.map((x: any) =>
                    x.id === r.id ? { ...x, enabled: v } : x,
                  ),
                })
              }
              label={`启用${r.name}`}
            />
          </div>
        ))}
        <div className="inline-actions">
          <button
            className="button secondary"
            onClick={() => config && save(config)}
            disabled={!config || saving}
          >
            <Save size={16} />
            保存备用音源
          </button>
          <span className="subtle">
            相同歌曲不同录音版本需注意时长，音质以返回音频为准
          </span>
        </div>
      </section>
      <section className="settings-section">
        <button
          className="advanced-trigger"
          onClick={() => {
            setAdvanced(!advanced);
            if (!advanced) setJson(JSON.stringify(config, null, 2));
          }}
        >
          <Code2 size={20} />
          <strong>高级：路由与字段映射</strong>
          <ChevronDown size={18} />
        </button>
        {advanced && (
          <>
            <p className="settings-intro">
              编辑 JSON 后立即生效，无需重新编译应用。items
              为候选列表路径，mapping 可覆盖 id / title / artist / cover
              等字段；备用音源支持 JSON 路径和 HTTP 重定向。
            </p>
            <textarea
              aria-label="接口配置 JSON"
              className="code-editor"
              spellCheck={false}
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <div className="inline-actions">
              <button
                className="button primary"
                disabled={saving}
                onClick={() => save(json)}
              >
                <Save size={16} />
                应用 JSON 配置
              </button>
              <button
                className="button secondary"
                onClick={async () => {
                  onProviders(await window.sonora.resetProfiles());
                  const r = await window.sonora.profiles();
                  setConfig(r.config);
                  setJson(JSON.stringify(r.config, null, 2));
                  notify("已恢复内置接口配置");
                }}
              >
                <RefreshCw size={15} />
                恢复内置配置
              </button>
            </div>
          </>
        )}
      </section>
      <section className="settings-section">
        <h2>平台独立音质与音源</h2>
        <p className="tag-note">
          默认音质适用于未单独设置的平台。母带、全景声与 DSD
          由发行规格和账号权益决定；空间音效不代表位深或采样率更高。DSD
          文件可下载和管理，系统播放器可能无法预览。
        </p>
        {(["netease", "qq", "kugou"] as Platform[]).map((platform) => (
          <div className="setting-row" key={platform}>
            <strong>{platformNames[platform]}</strong>
            <div className="inline-actions">
              <select
                aria-label={platformNames[platform] + "独立音质"}
                value={settings.qualityPreferences?.[platform] || ""}
                onChange={(e) =>
                  change({
                    qualityPreferences: {
                      ...settings.qualityPreferences,
                      [platform]: e.target.value as any,
                    },
                  })
                }
              >
                <option value="">跟随默认音质</option>
                {Object.entries(qualityNames)
                  .filter(
                    ([key]) =>
                      !(platform === "qq" && ["dsd", "clear"].includes(key)) &&
                      !(platform === "netease" && key === "dsd") &&
                      !(platform === "kugou" && key === "surround"),
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
              <select
                aria-label={platformNames[platform] + "独立音源"}
                value={settings.resolverPreferences?.[platform] || ""}
                onChange={(e) =>
                  change({
                    resolverPreferences: {
                      ...settings.resolverPreferences,
                      [platform]: e.target.value,
                    },
                  })
                }
              >
                <option value="">跟随全局音源</option>
                <option value="auto">自动（内置优先，按备用配置顺序）</option>
                <option value="builtin">仅内置接口</option>
                {config?.resolvers
                  ?.filter(
                    (r: any) => r.enabled && r.platforms.includes(platform),
                  )
                  .map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        ))}
        <div className="inline-actions">
          <button
            className="button secondary"
            onClick={() => onTools("recovery")}
          >
            备份与恢复中心
          </button>
          <button
            className="button secondary"
            onClick={() => onTools("diagnostics")}
          >
            查看诊断与音源健康
          </button>
        </div>
        {(["netease", "qq", "kugou"] as Platform[]).map((platform) => (
          <ResolverPriority
            key={platform}
            platform={platform}
            settings={settings}
            resolvers={config?.resolvers || []}
            onChange={change}
          />
        ))}
      </section>
      <section className="settings-section about">
        <div className="brand-mark small">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <h2>
            声屿 Sonora <span>{version}</span>
          </h2>
          <p>仅供学习使用，请于下载后24小时自行删除。</p>
          <p>应用不会自动删除已下载文件，请自行管理。</p>
        </div>
        <button
          className="button secondary"
          onClick={() => onTools("diagnostics")}
        >
          <Download size={15} />
          导出诊断
        </button>
      </section>
    </>
  );
}
