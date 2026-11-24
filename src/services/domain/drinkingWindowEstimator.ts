import type { WineColor } from '@/types/schema';

export interface DrinkingWindowEstimateInput {
  name?: string;
  country: string;
  region: string;
  subRegion?: string;
  color: WineColor;
  vintage: string; // 4자리 연도 또는 'NV'
  referenceYear?: number; // NV 와인의 기준 연도(기본: 구입연도 또는 올해)
}

export interface DrinkingWindowEstimate {
  start: number;
  end: number;
  basis: string;
}

const GRAND_CRU_RE =
  /grand\s*cru|그랑\s*크뤼|에세죠|echezeaux|클로\s*드\s*부조|clos\s*de\s*vougeot|샹베르탱|chambertin|로마네|roman[eé]e|뮈지니|musigny|꼬르통|corton|몽라쉐|montrachet|라\s*타슈|la\s*tache|리쉬부르|richebourg/i;
const PREMIER_CRU_RE = /1er\s*cru|premier\s*cru|프리미어\s*크뤼/i;
const BORDEAUX_TOP_COMMUNES = new Set([
  '뽀이약',
  '생줄리앙',
  '마고',
  '생테스테프',
  '페삭 레오냥',
  '포므롤',
  '생떼밀리옹',
]);
const BURGUNDY_RED_TOP_COMMUNES = new Set([
  '에세죠',
  '클로 드 부조',
  '본 로마네',
  '샹볼 뮈지니',
  '쥬브레 샹베르탱',
  '모레 생 드니',
  '뉘 생 조르주',
  '볼네',
  '뽀마르',
]);
const BURGUNDY_WHITE_TOP_COMMUNES = new Set([
  '뫼르소',
  '샤샤뉴 몽라쉐',
  '퓔리니 몽라쉐',
  '꼬르통',
  '본',
]);
const NORTHERN_RHONE_COMMUNES = new Set([
  '코트 로티',
  '에르미타주',
  '크로즈 에르미타주',
  '생 조셉',
  '코르나스',
]);

/**
 * Wine Spectator · Robert Parker(Wine Advocate) · Wine Society 지역·빈티지 차트 기반
 * 적정 음용 시기(시작연도 ~ 종료연도) 순수 추정 엔진
 */
export function estimateDrinkingWindow(
  input: DrinkingWindowEstimateInput,
): DrinkingWindowEstimate | null {
  const vintageClean = input.vintage.trim().toUpperCase();
  const country = input.country.trim();
  const region = input.region.trim();
  const subRegion = (input.subRegion ?? '').trim();
  const name = (input.name ?? '').trim();
  const combinedText = `${name} ${region} ${subRegion}`;

  // 1) NV (Non-Vintage)
  if (vintageClean === 'NV') {
    const baseYear = input.referenceYear ?? new Date().getFullYear();
    if (input.color === 'SP') {
      return { start: baseYear, end: baseYear + 3, basis: '상파뉴/스파클링 NV 기준' };
    }
    if (input.color === 'SW') {
      return { start: baseYear, end: baseYear + 10, basis: '스위트/주정강화 NV 기준' };
    }
    return { start: baseYear, end: baseYear + 2, basis: '일반 NV 기준' };
  }

  if (!/^\d{4}$/.test(vintageClean)) {
    return null;
  }
  const v = Number(vintageClean);
  if (v < 1900 || v > 2100) return null;

  const isGrandCru = GRAND_CRU_RE.test(combinedText);
  const isPremierCru = PREMIER_CRU_RE.test(combinedText);

  let startOffset = 2;
  let endOffset = 8;
  let basis = '일반 레드 기준';
  let vintageBucket: 'bordeaux' | 'burgundy' | 'piedmont' | 'tuscany' | 'napa' | null = null;

  // 2) 지역 · 등급 · 색상별 기본 숙성 오프셋
  if (region === '보르도' || subRegion === '소떼른' || subRegion === '바르삭') {
    if (input.color === 'SW' || subRegion === '소떼른' || subRegion === '바르삭') {
      startOffset = 8;
      endOffset = 30;
      basis = '보르도 소떼른/스위트 기준';
    } else if (input.color === 'W') {
      const isPessac = subRegion === '페삭 레오냥' || /pessac|graves|페삭/i.test(combinedText);
      startOffset = isPessac ? 3 : 2;
      endOffset = isPessac ? 12 : 8;
      basis = isPessac ? '보르도 페삭 레오냥(화이트) 기준' : '보르도 화이트 기준';
    } else {
      const isTopBordeaux =
        BORDEAUX_TOP_COMMUNES.has(subRegion) ||
        isGrandCru ||
        /cru\s*class[eé]|그랑\s*크뤼/i.test(combinedText);
      startOffset = isTopBordeaux ? 8 : 4;
      endOffset = isTopBordeaux ? 25 : 12;
      basis = isTopBordeaux ? '보르도 그랑크뤼/주요 마을(레드) 기준' : '보르도 일반(레드) 기준';
      vintageBucket = 'bordeaux';
    }
  } else if (region === '부르고뉴') {
    if (input.color === 'W') {
      if (subRegion === '샤블리' || /chablis|샤블리/i.test(combinedText)) {
        if (isGrandCru) {
          startOffset = 6;
          endOffset = 18;
          basis = '부르고뉴 샤블리 그랑크뤼 기준';
        } else if (isPremierCru) {
          startOffset = 3;
          endOffset = 10;
          basis = '부르고뉴 샤블리 1er 기준';
        } else {
          startOffset = 2;
          endOffset = 7;
          basis = '부르고뉴 샤블리 빌라쥬 기준';
        }
      } else if (isGrandCru) {
        startOffset = 5;
        endOffset = 16;
        basis = '부르고뉴 화이트 그랑크뤼 기준';
      } else if (isPremierCru || BURGUNDY_WHITE_TOP_COMMUNES.has(subRegion)) {
        startOffset = 4;
        endOffset = 12;
        basis = '부르고뉴 화이트 1er/주요 마을 기준';
      } else {
        startOffset = 2;
        endOffset = 7;
        basis = '부르고뉴 화이트 빌라쥬/지역급 기준';
      }
      vintageBucket = 'burgundy';
    } else {
      if (isGrandCru) {
        startOffset = 7;
        endOffset = 22;
        basis = '부르고뉴 레드 그랑크뤼 기준';
      } else if (isPremierCru || BURGUNDY_RED_TOP_COMMUNES.has(subRegion)) {
        startOffset = 5;
        endOffset = 16;
        basis = '부르고뉴 레드 1er/주요 마을 기준';
      } else {
        startOffset = 3;
        endOffset = 10;
        basis = '부르고뉴 레드 빌라쥬/지역급 기준';
      }
      vintageBucket = 'burgundy';
    }
  } else if (region === '상파뉴' || (country === '프랑스' && input.color === 'SP')) {
    startOffset = 7;
    endOffset = 20;
    basis = '상파뉴 빈티지 기준';
  } else if (region === '론') {
    if (NORTHERN_RHONE_COMMUNES.has(subRegion) || /c[oô]te[\s-]r[oô]tie|hermitage|cornas/i.test(combinedText)) {
      startOffset = 6;
      endOffset = 20;
      basis = '북부 론(시라) 기준';
    } else if (/ch[aâ]teauneuf|cdp|샤토뇌프|지공다스|gigondas/i.test(combinedText)) {
      startOffset = 5;
      endOffset = 16;
      basis = '남부 론(CDP/지공다스) 기준';
    } else {
      startOffset = 3;
      endOffset = 10;
      basis = '론 일반 기준';
    }
  } else if (region === '알자스' || region === '루아르') {
    if (input.color === 'SW') {
      startOffset = 6;
      endOffset = 22;
      basis = `${region} 스위트 기준`;
    } else if (input.color === 'W') {
      startOffset = 3;
      endOffset = 12;
      basis = `${region} 화이트 기준`;
    } else {
      startOffset = 3;
      endOffset = 10;
      basis = `${region} 레드 기준`;
    }
  } else if (region === '피에몬테') {
    if (subRegion === '바롤로' || /barolo|바롤로/i.test(combinedText)) {
      startOffset = 9;
      endOffset = 26;
      basis = '피에몬테 바롤로 기준';
      vintageBucket = 'piedmont';
    } else if (subRegion === '바르바레스코' || /barbaresco|바르바레스코/i.test(combinedText)) {
      startOffset = 7;
      endOffset = 20;
      basis = '피에몬테 바르바레스코 기준';
      vintageBucket = 'piedmont';
    } else if (input.color === 'R') {
      startOffset = 3;
      endOffset = 10;
      basis = '피에몬테 레드 기준';
    } else {
      startOffset = 1;
      endOffset = 5;
      basis = '피에몬테 화이트/스파클링 기준';
    }
  } else if (region === '토스카나') {
    if (subRegion === '몬탈치노' || /brunello|bdm|브루넬로/i.test(combinedText)) {
      startOffset = 7;
      endOffset = 22;
      basis = '토스카나 브루넬로 디 몬탈치노 기준';
      vintageBucket = 'tuscany';
    } else if (subRegion === '볼게리' || /bolgheri|sassicaia|ornellaia|tignanello|solaia|볼게리/i.test(combinedText)) {
      startOffset = 6;
      endOffset = 20;
      basis = '토스카나 볼게리/수퍼투스칸 기준';
      vintageBucket = 'tuscany';
    } else if (subRegion === '키안티 클라시코' || /chianti|키안티/i.test(combinedText)) {
      startOffset = 3;
      endOffset = 12;
      basis = '토스카나 키안티 기준';
    } else if (input.color === 'R') {
      startOffset = 4;
      endOffset = 12;
      basis = '토스카나 레드 기준';
    } else {
      startOffset = 1;
      endOffset = 6;
      basis = '토스카나 화이트/기타 기준';
    }
  } else if (country === '이탈리아' && /amarone|아마로네/i.test(combinedText)) {
    startOffset = 7;
    endOffset = 22;
    basis = '베네토 아마로네 기준';
  } else if (region === '나파' || /napa|나파/i.test(combinedText)) {
    if (input.color === 'R') {
      startOffset = 6;
      endOffset = 20;
      basis = '미국 나파 밸리(레드) 기준';
      vintageBucket = 'napa';
    } else {
      startOffset = 2;
      endOffset = 8;
      basis = '미국 나파(화이트) 기준';
    }
  } else if (region === '오레곤' || region === '소노마') {
    if (input.color === 'R') {
      startOffset = 3;
      endOffset = 12;
      basis = `미국 ${region}(레드) 기준`;
    } else {
      startOffset = 2;
      endOffset = 8;
      basis = `미국 ${region}(화이트) 기준`;
    }
  } else if (country === '미국') {
    startOffset = input.color === 'R' ? 4 : 2;
    endOffset = input.color === 'R' ? 14 : 7;
    basis = input.color === 'R' ? '미국 레드 기준' : '미국 화이트/기타 기준';
  } else if (country === '독일' || country === '오스트리아' || country === '헝가리') {
    if (input.color === 'SW' || /auslese|beerenauslese|tba|eiswein|tokaji|토카이/i.test(combinedText)) {
      startOffset = 7;
      endOffset = 28;
      basis = `${country} 스위트 리슬링/토카이 기준`;
    } else if (input.color === 'W') {
      startOffset = 4;
      endOffset = 16;
      basis = `${country} 화이트/리슬링 기준`;
    } else {
      startOffset = 3;
      endOffset = 10;
      basis = `${country} 레드 기준`;
    }
  } else if (country === '스페인' || country === '포르투갈') {
    if (input.color === 'SW' || /port|포트|sherry|헤레스|madeira/i.test(combinedText)) {
      startOffset = 6;
      endOffset = 28;
      basis = `${country} 주정강화/스위트 기준`;
    } else if (input.color === 'SP') {
      startOffset = 2;
      endOffset = 7;
      basis = '스페인 카바/스파클링 기준';
    } else if (/gran\s*reserva|그랑\s*리세르바/i.test(combinedText)) {
      startOffset = 8;
      endOffset = 26;
      basis = '스페인 그랑 리세르바 기준';
    } else if (region === '리오하' || region === '리베라 델 두에로' || region === '프리오랏') {
      startOffset = 6;
      endOffset = 20;
      basis = `스페인 ${region} 기준`;
    } else {
      startOffset = input.color === 'R' ? 3 : 1;
      endOffset = input.color === 'R' ? 10 : 5;
      basis = `${country} 일반 기준`;
    }
  } else if (country === '호주' || country === '뉴질랜드' || country === '칠레' || country === '아르헨티나') {
    if (input.color === 'R') {
      startOffset = 3;
      endOffset = 12;
      basis = `${country} 레드 기준`;
    } else if (input.color === 'W') {
      startOffset = 1;
      endOffset = 6;
      basis = `${country} 화이트 기준`;
    } else if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 18;
      basis = `${country} 스위트 기준`;
    } else {
      startOffset = 1;
      endOffset = 4;
      basis = `${country} 스파클링/로제 기준`;
    }
  } else {
    // 색상별 일반 폴백
    if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 20;
      basis = '일반 스위트/주정강화 기준';
    } else if (input.color === 'SP') {
      startOffset = 2;
      endOffset = 8;
      basis = '일반 스파클링 기준';
    } else if (input.color === 'RO') {
      startOffset = 1;
      endOffset = 3;
      basis = '일반 로제 기준';
    } else if (input.color === 'W') {
      startOffset = 1;
      endOffset = 5;
      basis = '일반 화이트 기준';
    } else {
      startOffset = 2;
      endOffset = 8;
      basis = '일반 레드 기준';
    }
  }

  // 3) 주요 빈티지 작황 보정 (Wine Spectator & Wine Advocate 종합)
  let vintageAdjStart = 0;
  let vintageAdjEnd = 0;
  let vintageNote = '';

  if (vintageBucket === 'bordeaux') {
    if ([2010, 2016, 2018, 2019, 2020, 2022].includes(v)) {
      vintageAdjStart = 1;
      vintageAdjEnd = 3;
      vintageNote = `${v} 장기 숙성형`;
    } else if ([2017, 2021].includes(v)) {
      vintageAdjStart = -1;
      vintageAdjEnd = -2;
      vintageNote = `${v} 조기 접근형`;
    }
  } else if (vintageBucket === 'burgundy') {
    if ([2015, 2016, 2019, 2020, 2021].includes(v)) {
      vintageAdjStart = 1;
      vintageAdjEnd = 2;
      vintageNote = `${v} 숙성형`;
    } else if ([2017, 2018].includes(v)) {
      vintageAdjStart = -1;
      vintageAdjEnd = -1;
      vintageNote = `${v} 조기 접근형`;
    }
  } else if (vintageBucket === 'piedmont') {
    if ([2010, 2016, 2019, 2021].includes(v)) {
      vintageAdjStart = 1;
      vintageAdjEnd = 3;
      vintageNote = `${v} 장기 숙성형`;
    } else if ([2015, 2017, 2018].includes(v)) {
      vintageAdjStart = -1;
      vintageAdjEnd = -1;
      vintageNote = `${v} 조기 접근형`;
    }
  } else if (vintageBucket === 'tuscany') {
    if ([2010, 2016, 2019, 2021].includes(v)) {
      vintageAdjStart = 1;
      vintageAdjEnd = 2;
      vintageNote = `${v} 숙성형`;
    } else if ([2017, 2018].includes(v)) {
      vintageAdjStart = -1;
      vintageAdjEnd = -1;
      vintageNote = `${v} 조기 접근형`;
    }
  } else if (vintageBucket === 'napa') {
    if ([2016, 2018, 2019, 2021].includes(v)) {
      vintageAdjStart = 1;
      vintageAdjEnd = 2;
      vintageNote = `${v} 장기 숙성형`;
    } else if ([2015, 2020, 2022].includes(v)) {
      vintageAdjStart = -1;
      vintageAdjEnd = -2;
      vintageNote = `${v} 조기 음용형`;
    }
  }

  const finalStartOffset = Math.max(1, startOffset + vintageAdjStart);
  const finalEndOffset = Math.max(finalStartOffset + 2, endOffset + vintageAdjEnd);

  return {
    start: v + finalStartOffset,
    end: v + finalEndOffset,
    basis: vintageNote ? `${basis} · ${vintageNote}` : basis,
  };
}
