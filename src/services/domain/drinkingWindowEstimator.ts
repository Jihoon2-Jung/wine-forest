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

/**
 * 부르고뉴 빌라쥬(마을) 명칭에 그랑크뤼 밭 이름이 포함된 오탐 방지용 정제:
 * 예) 'Gevrey-Chambertin' / '쥬브레 샹베르탱', 'Vosne-Romanée' / '본 로마네',
 *     'Chambolle-Musigny' / '샹볼 뮈지니', 'Chassagne/Puligny-Montrachet' / '샤샤뉴·퓔리니 몽라쉐',
 *     'Aloxe-Corton' / '알록스 꼬르똥'은 빌라쥬 명칭이므로 먼저 제거한 뒤 그랑크뤼 밭명을 판별합니다.
 */
const VILLAGE_HYPHEN_STRIP_RE =
  /gevrey[\s-]*chambertin|쥬브레[\s-]*샹베르탱|vosne[\s-]*roman[eé]e|본[\s-]*로마네|chambolle[\s-]*musigny|샹볼[\s-]*뮈지니|chassagne[\s-]*montrachet|샤샤뉴[\s-]*몽라쉐|puligny[\s-]*montrachet|퓔리니[\s-]*몽라쉐|aloxe[\s-]*corton|알록스[\s-]*꼬르[통똥]/gi;

const ALOXE_CORTON_RE = /aloxe[\s-]*corton|알록스[\s-]*꼬르[통똥]/i;

const EXPLICIT_GRAND_CRU_RE =
  /grand\s*cru|그랑\s*크뤼|에세죠|[eé]ch[eé]zeaux|클로\s*드\s*부조|clos\s*(?:de\s*)?vougeot|라\s*타슈|la\s*t[aâ]che|리쉬부르|richebourg|로마네[\s-]*(콩티|생[\s-]*비방)|roman[eé]e[\s-]*(conti|saint[\s-]*vivant|st\.?[\s-]*vivant)|바타르[\s-]*몽라쉐|b[aâ]tard[\s-]*montrachet|슈발리에[\s-]*몽라쉐|chevalier[\s-]*montrachet|꼬르[통똥][\s-]*샤를마뉴|corton[\s-]*charlemagne|클로\s*드\s*베즈|clos\s*de\s*b[eè]ze|(mazis|charmes|griotte|latrici[eè]res|ruchottes|chapelle|mazoy[eè]res)[\s-]*chambertin|본[\s-]*마르|bonnes[\s-]*mares|클로\s*(생[\s-]*드니|드\s*라\s*로쉬|드\s*타르|데\s*랑브레)|clos\s*(?:(?:saint|st\.?)[\s-]*denis|de\s*la\s*roche|de\s*tart|des\s*lambrays)/i;

const STANDALONE_GRAND_CRU_RE =
  /\b(chambertin|musigny|corton|montrachet)\b|(^|[\s,])(샹베르탱|뮈지니|꼬르[통똥]|몽라쉐)([\s,]|$)/i;

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
const BORDEAUX_TOP_COMMUNES_EN_RE =
  /\b(pauillac|saint[\s-]*julien|st\.?[\s-]*julien|margaux|saint[\s-]*est[eè]phe|st\.?[\s-]*est[eè]phe|pessac[\s-]*l[eé]ognan|pomerol|saint[\s-]*[eé]milion|st\.?[\s-]*[eé]milion)\b/i;

const BURGUNDY_RED_TOP_COMMUNES = new Set([
  '본 로마네',
  '샹볼 뮈지니',
  '쥬브레 샹베르탱',
  '모레 생 드니',
  '뉘 생 조르주',
  '볼네',
  '뽀마르',
  '알록스 꼬르똥',
]);
const BURGUNDY_RED_TOP_COMMUNES_EN_RE =
  /\b(vosne[\s-]*roman[eé]e|chambolle[\s-]*musigny|gevrey[\s-]*chambertin|morey[\s-]*saint[\s-]*denis|nuits[\s-]*saint[\s-]*georges|volnay|pommard|aloxe[\s-]*corton)\b/i;

const BURGUNDY_WHITE_TOP_COMMUNES = new Set([
  '뫼르소',
  '샤샤뉴 몽라쉐',
  '퓔리니 몽라쉐',
  '본',
  '알록스 꼬르똥',
]);
const BURGUNDY_WHITE_TOP_COMMUNES_EN_RE =
  /\b(meursault|chassagne[\s-]*montrachet|puligny[\s-]*montrachet|beaune|aloxe[\s-]*corton)\b/i;

const NORTHERN_RHONE_COMMUNES = new Set([
  '코트 로티',
  '에르미타주',
  '크로즈 에르미타주',
  '생 조셉',
  '코르나스',
]);

function isBurgundyGrandCru(name: string, subRegion: string): boolean {
  const combined = `${name} ${subRegion}`;
  if (EXPLICIT_GRAND_CRU_RE.test(combined)) {
    return true;
  }
  // Aloxe-Corton 빌라쥬 와인이 기존 엑셀 subRegion='꼬르똥'과 결합해 그랑크뤼로 오탐되는 문제 차단
  if (ALOXE_CORTON_RE.test(name) || ALOXE_CORTON_RE.test(subRegion)) {
    return false;
  }
  const stripped = combined.replace(VILLAGE_HYPHEN_STRIP_RE, ' ');
  return STANDALONE_GRAND_CRU_RE.test(stripped);
}

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
    const baseYear =
      typeof input.referenceYear === 'number' &&
      Number.isInteger(input.referenceYear) &&
      input.referenceYear >= 1900 &&
      input.referenceYear <= 2100
        ? input.referenceYear
        : new Date().getFullYear();
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

  // 2) 로제(RO)는 지역 불문 신선 음용이 기본 (레드 장기 숙성 오분류 방지)
  if (input.color === 'RO') {
    return {
      start: v + 1,
      end: v + 3,
      basis: '로제 와인 기준',
    };
  }

  // 3) 스파클링(SP): 상파뉴 빈티지만 장기 숙성(+7~+20), 크레망·카바·프로세코 등은 중단기
  if (input.color === 'SP') {
    const isChampagne = region === '상파뉴' || /champagne|상파뉴|샴페인/i.test(combinedText);
    if (isChampagne) {
      return { start: v + 7, end: v + 20, basis: '상파뉴 빈티지 기준' };
    }
    const isCremant = /cr[eé]mant|크레망/i.test(combinedText) || country === '프랑스';
    if (isCremant) {
      return { start: v + 2, end: v + 6, basis: '크레망/프랑스 스파클링 기준' };
    }
    if (country === '스페인') {
      return { start: v + 2, end: v + 7, basis: '스페인 카바/스파클링 기준' };
    }
    return { start: v + 2, end: v + 6, basis: '일반 스파클링 기준' };
  }

  const isGrandCru = isBurgundyGrandCru(name, subRegion);
  const isPremierCru = PREMIER_CRU_RE.test(combinedText);

  let startOffset = 2;
  let endOffset = 8;
  let basis = '일반 레드 기준';
  let vintageBucket: 'bordeaux' | 'burgundy' | 'piedmont' | 'tuscany' | 'napa' | null = null;

  // 4) 지역 · 등급 · 색상별 기본 숙성 오프셋
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
        BORDEAUX_TOP_COMMUNES_EN_RE.test(combinedText) ||
        /grand\s*cru|cru\s*class[eé]|그랑\s*크뤼/i.test(combinedText);
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
      } else if (
        isPremierCru ||
        BURGUNDY_WHITE_TOP_COMMUNES.has(subRegion) ||
        BURGUNDY_WHITE_TOP_COMMUNES_EN_RE.test(combinedText)
      ) {
        startOffset = 4;
        endOffset = 12;
        basis = '부르고뉴 화이트 1er/주요 마을 기준';
      } else {
        startOffset = 2;
        endOffset = 7;
        basis = '부르고뉴 화이트 빌라쥬/지역급 기준';
      }
      vintageBucket = 'burgundy';
    } else if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 18;
      basis = '부르고뉴 스위트 기준';
    } else {
      if (isGrandCru) {
        startOffset = 7;
        endOffset = 22;
        basis = '부르고뉴 레드 그랑크뤼 기준';
      } else if (
        isPremierCru ||
        BURGUNDY_RED_TOP_COMMUNES.has(subRegion) ||
        BURGUNDY_RED_TOP_COMMUNES_EN_RE.test(combinedText)
      ) {
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
  } else if (region === '론') {
    if (input.color === 'W') {
      startOffset = 2;
      endOffset = 8;
      basis = '론 화이트 기준';
    } else if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 18;
      basis = '론 스위트 기준';
    } else if (
      NORTHERN_RHONE_COMMUNES.has(subRegion) ||
      /c[oô]te[\s-]r[oô]tie|hermitage|cornas/i.test(combinedText)
    ) {
      startOffset = 6;
      endOffset = 20;
      basis = '북부 론(시라) 기준';
    } else if (/ch[aâ]teauneuf|cdp|샤[토또]뇌프|지공다스|gigondas/i.test(combinedText)) {
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
    if (input.color === 'R' && (subRegion === '바롤로' || /barolo|바롤로/i.test(combinedText))) {
      startOffset = 9;
      endOffset = 26;
      basis = '피에몬테 바롤로 기준';
      vintageBucket = 'piedmont';
    } else if (
      input.color === 'R' &&
      (subRegion === '바르바레스코' || /barbaresco|바르바레스코/i.test(combinedText))
    ) {
      startOffset = 7;
      endOffset = 20;
      basis = '피에몬테 바르바레스코 기준';
      vintageBucket = 'piedmont';
    } else if (input.color === 'R') {
      startOffset = 3;
      endOffset = 10;
      basis = '피에몬테 레드 기준';
    } else if (input.color === 'SW') {
      startOffset = 2;
      endOffset = 7;
      basis = '피에몬테 스위트 기준';
    } else {
      startOffset = 1;
      endOffset = 5;
      basis = '피에몬테 화이트 기준';
    }
  } else if (region === '토스카나') {
    if (input.color === 'W') {
      startOffset = 1;
      endOffset = 6;
      basis = '토스카나 화이트 기준';
    } else if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 20;
      basis = '토스카나 빈 산토/스위트 기준';
    } else if (/rosso\s+di\s+montalcino|로쏘\s*디\s*몬탈치노/i.test(combinedText)) {
      startOffset = 2;
      endOffset = 8;
      basis = '토스카나 로쏘 디 몬탈치노 기준';
    } else if (subRegion === '몬탈치노' || /brunello|bdm|브루넬로/i.test(combinedText)) {
      startOffset = 7;
      endOffset = 22;
      basis = '토스카나 브루넬로 디 몬탈치노 기준';
      vintageBucket = 'tuscany';
    } else if (
      subRegion === '볼게리' ||
      /bolgheri|sassicaia|ornellaia|tignanello|solaia|볼게리/i.test(combinedText)
    ) {
      startOffset = 6;
      endOffset = 20;
      basis = '토스카나 볼게리/수퍼투스칸 기준';
      vintageBucket = 'tuscany';
    } else if (subRegion === '키안티 클라시코' || /chianti|키안티/i.test(combinedText)) {
      startOffset = 3;
      endOffset = 12;
      basis = '토스카나 키안티 기준';
    } else {
      startOffset = 4;
      endOffset = 12;
      basis = '토스카나 레드 기준';
    }
  } else if (country === '이탈리아' && input.color === 'R' && /amarone|아마로네/i.test(combinedText)) {
    startOffset = 7;
    endOffset = 22;
    basis = '베네토 아마로네 기준';
  } else if (
    (country === '미국' || !country) &&
    (region === '나파' || /\bnapa\b|나파/i.test(combinedText))
  ) {
    if (input.color === 'R') {
      startOffset = 6;
      endOffset = 20;
      basis = '미국 나파 밸리(레드) 기준';
      vintageBucket = 'napa';
    } else if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 20;
      basis = '미국 나파(스위트) 기준';
    } else {
      startOffset = 2;
      endOffset = 8;
      basis = '미국 나파(화이트) 기준';
    }
  } else if ((country === '미국' || !country) && (region === '오레곤' || region === '소노마')) {
    if (input.color === 'R') {
      startOffset = 3;
      endOffset = 12;
      basis = `미국 ${region}(레드) 기준`;
    } else if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 20;
      basis = `미국 ${region}(스위트) 기준`;
    } else {
      startOffset = 2;
      endOffset = 8;
      basis = `미국 ${region}(화이트) 기준`;
    }
  } else if (country === '미국') {
    if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 20;
      basis = '미국 스위트 기준';
    } else {
      startOffset = input.color === 'R' ? 4 : 2;
      endOffset = input.color === 'R' ? 14 : 7;
      basis = input.color === 'R' ? '미국 레드 기준' : '미국 화이트/기타 기준';
    }
  } else if (country === '독일' || country === '오스트리아' || country === '헝가리') {
    const isExplicitDry = /\b(trocken|dry)\b|드라이/i.test(combinedText);
    if (
      input.color === 'SW' ||
      (!isExplicitDry &&
        /\b(auslese|beerenauslese|tba|eiswein|tokaji)\b|토카이/i.test(combinedText))
    ) {
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
    if (
      input.color === 'SW' ||
      /\b(port|porto|vintage\s+port|tawny|ruby\s+port|lbv|sherry|madeira)\b|포트|헤레스/i.test(
        combinedText,
      )
    ) {
      startOffset = 6;
      endOffset = 28;
      basis = `${country} 주정강화/스위트 기준`;
    } else if (input.color === 'W') {
      startOffset = 2;
      endOffset = 8;
      basis = `${country} 화이트 기준`;
    } else if (/gran\s*reserva|그랑\s*리세르바/i.test(combinedText)) {
      startOffset = 8;
      endOffset = 26;
      basis = '스페인 그랑 리세르바 기준';
    } else if (region === '리오하' || region === '리베라 델 두에로' || region === '프리오랏') {
      startOffset = 6;
      endOffset = 20;
      basis = `스페인 ${region} 기준`;
    } else {
      startOffset = 3;
      endOffset = 10;
      basis = `${country} 레드 기준`;
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
    } else {
      startOffset = 5;
      endOffset = 18;
      basis = `${country} 스위트 기준`;
    }
  } else {
    // 색상별 일반 폴백
    if (input.color === 'SW') {
      startOffset = 5;
      endOffset = 20;
      basis = '일반 스위트/주정강화 기준';
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

  // 5) 주요 빈티지 작황 보정 (Wine Spectator & Wine Advocate 종합)
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
