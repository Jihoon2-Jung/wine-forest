import { EyeOff } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PriceBucketItem } from '@/services/analytics/statsCalculator';
import { useWineStore } from '@/store/useWineStore';

export function PriceDistChart({ data }: { data: PriceBucketItem[] }) {
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);

  return (
    <div className="relative rounded-2xl border border-subtle bg-surface p-4 shadow-card">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-primary">가격대별 보유 분포</h3>
        <p className="text-[11px] text-secondary">보유 중인 병의 단가 구간 분포</p>
      </div>

      {/* M2 보강: 프라이버시 모드 ON 시 가격대 분포 차트 전체 마스킹 오버레이 */}
      {isPrivacyMode ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-subtle bg-elevated/60 text-center">
          <EyeOff className="h-7 w-7 text-burgundy" />
          <p className="mt-2 text-xs font-bold text-primary">가격 숨김 모드 활성화됨</p>
          <p className="mt-0.5 text-[11px] text-secondary">
            상단 👁️ 토글을 해제하면 가격대별 분포를 확인할 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
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
              <Bar dataKey="count" fill="var(--brand-gold)" radius={[6, 6, 0, 0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
