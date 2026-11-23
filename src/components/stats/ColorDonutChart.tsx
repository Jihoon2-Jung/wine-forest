import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { WineColor } from '@/types/schema';
import type { ColorDistributionItem } from '@/services/analytics/statsCalculator';
import { getWineColorBorderCssVar, getWineColorCssVar } from '@/components/common/WineColorBadge';
import { PriceText } from '@/components/common/PriceText';

interface ColorDonutChartProps {
  data: ColorDistributionItem[];
  onSelectColor: (color: WineColor) => void;
}

export function ColorDonutChart({ data, onSelectColor }: ColorDonutChartProps) {
  return (
    <div className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-primary">색상별 보유 비중</h3>
          <p className="text-[11px] text-secondary">조각 클릭 시 해당 색상 목록으로 이동</p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-xs text-secondary">
          보유 중인 와인이 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-12">
          <div className="h-52 sm:col-span-6">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                  onClick={(entry: ColorDistributionItem) => onSelectColor(entry.color)}
                  className="cursor-pointer outline-none"
                >
                  {data.map((item) => (
                    <Cell
                      key={item.color}
                      fill={getWineColorCssVar(item.color)}
                      stroke="var(--bg-surface)"
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [`${value}병`, '보유']}
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 sm:col-span-6">
            {data.map((item) => (
              <button
                key={item.color}
                type="button"
                onClick={() => onSelectColor(item.color)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-subtle/60 bg-elevated/50 px-3 py-2 text-xs transition-colors hover:border-forest"
              >
                <span className="flex min-w-0 items-center gap-2 font-semibold text-primary">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: getWineColorCssVar(item.color),
                      boxShadow: getWineColorBorderCssVar(item.color)
                        ? `inset 0 0 0 1px ${getWineColorBorderCssVar(item.color)}`
                        : undefined,
                    }}
                  />
                  <span className="truncate whitespace-nowrap">{item.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums">
                  <strong className="text-primary">{item.count}병</strong>
                  <span className="w-10 text-right text-secondary">{item.ratio}%</span>
                  <PriceText value={item.value} compact className="hidden text-secondary xl:inline" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
