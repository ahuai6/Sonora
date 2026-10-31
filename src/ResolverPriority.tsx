import type { Platform, Settings } from "./types";
import { platformNames } from "./ui";
export default function ResolverPriority({
  platform,
  settings,
  resolvers,
  onChange,
}: {
  platform: Platform;
  settings: Settings;
  resolvers: any[];
  onChange: (p: Partial<Settings>) => void;
}) {
  const sources = [
    { id: "builtin", name: "内置接口" },
    ...resolvers.filter((r) => r.enabled && r.platforms.includes(platform)),
  ];
  const available = sources.map((x) => x.id),
    order = [
      ...new Set([...(settings.resolverOrder?.[platform] || []), ...available]),
    ].filter((x) => available.includes(x));
  return (
    <details className="resolver-priority">
      <summary>{platformNames[platform]}自动取链顺序</summary>
      {order.map((id, i) => (
        <div className="setting-row" key={id}>
          <span>
            {i + 1}. {sources.find((x) => x.id === id)?.name}
          </span>
          <div>
            <button
              className="text-button"
              disabled={!i}
              onClick={() => {
                const next = [...order];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange({
                  resolverOrder: {
                    ...settings.resolverOrder,
                    [platform]: next,
                  },
                });
              }}
            >
              上移
            </button>
            <button
              className="text-button"
              disabled={i === order.length - 1}
              onClick={() => {
                const next = [...order];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange({
                  resolverOrder: {
                    ...settings.resolverOrder,
                    [platform]: next,
                  },
                });
              }}
            >
              下移
            </button>
          </div>
        </div>
      ))}
    </details>
  );
}
