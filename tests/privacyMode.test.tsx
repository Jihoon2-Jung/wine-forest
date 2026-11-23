import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { calculateKpiSummary, calculatePriceDistribution } from '@/services/analytics/statsCalculator';
import { createDemoDatabase } from '@/services/storage/defaultTemplates';
import { useWineStore } from '@/store/useWineStore';
import { FxNoteText, MemoText, PriceText } from '@/components/common/PriceText';
import { KpiGrid } from '@/components/stats/KpiGrid';
import { PriceDistChart } from '@/components/stats/PriceDistChart';

describe('Global Privacy Mode Masking', () => {
  beforeEach(() => {
    useWineStore.setState({ isPrivacyMode: false });
  });

  it('shows prices and fxNote when privacy mode is OFF and masks all when ON', () => {
    const db = createDemoDatabase();
    const kpi = calculateKpiSummary(db);
    const dist = calculatePriceDistribution(db);

    const { rerender } = render(
      <div>
        <PriceText value={165000} />
        <FxNoteText note="95유로" />
        <MemoText text="추가 5만*6개" />
        <KpiGrid kpi={kpi} />
        <PriceDistChart data={dist} />
      </div>,
    );

    expect(screen.getByText('₩165,000')).toBeInTheDocument();
    expect(screen.getByText('95유로')).toBeInTheDocument();
    expect(screen.getByText('추가 5만*6개')).toBeInTheDocument();
    expect(screen.getByText('₩988,000')).toBeInTheDocument();

    act(() => {
      useWineStore.setState({ isPrivacyMode: true });
    });
    rerender(
      <div>
        <PriceText value={165000} />
        <FxNoteText note="95유로" />
        <MemoText text="추가 5만*6개" />
        <KpiGrid kpi={kpi} />
        <PriceDistChart data={dist} />
      </div>,
    );

    expect(screen.queryByText('₩165,000')).not.toBeInTheDocument();
    expect(screen.queryByText('95유로')).not.toBeInTheDocument();
    expect(screen.queryByText('추가 5만*6개')).not.toBeInTheDocument();
    expect(screen.queryByText('₩988,000')).not.toBeInTheDocument();
    expect(screen.queryByText('₩935,000')).not.toBeInTheDocument();
    expect(screen.getAllByText('••••원').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText('••••(외화)')).toBeInTheDocument();
    expect(screen.getByText('•••• (메모 숨김)')).toBeInTheDocument();
    expect(screen.getByText('가격 숨김 모드 활성화됨')).toBeInTheDocument();
  });
});
