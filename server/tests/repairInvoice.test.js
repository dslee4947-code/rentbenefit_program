import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepairInvoice } from '../utils/repairInvoice.js';

// 정비소 점검·정비 명세서 (부품·공임 칸이 따로)
const SHEET = `자동차 점검·정비 명세서
차량번호 125호2370   차종 E350   주행거리 82,410 km
입고일자 2026-10-20   출고일자 2026.10.22
상호 한성모터스 성동  사업자등록번호 123-45-67890
번호 작업내용 수량 단가 부품 공임
1 엔진오일 1 45,000 45,000 20,000
2 오일필터 1 18,000 18,000 0
3 브레이크패드(앞) 1 120,000 120,000 50,000
부품계 183,000
공임계 70,000
공급가액 253,000
부가세 25,300
합계 278,300`;

test('명세서: 차량·날짜·업체·줄·합계를 읽는다', () => {
  const r = parseRepairInvoice(SHEET);
  assert.equal(r.plateNo, '125호2370');
  assert.equal(r.inDate, '2026-10-20');
  assert.equal(r.outDate, '2026-10-22');
  assert.equal(r.mileage, 82410);
  assert.equal(r.bizNo, '123-45-67890');
  assert.equal(r.shop, '한성모터스 성동');
  assert.equal(r.lines.length, 3);
  assert.deepEqual(r.lines[0], { name: '엔진오일', qty: 1, unitPrice: 45000, parts: 45000, labor: 20000, amount: 65000 });
  assert.equal(r.supply, 253000);
  assert.equal(r.vat, 25300);
  assert.equal(r.total, 278300);
  assert.deepEqual(r.warnings, []);
});

// 사고 수리 견적서 (금액 한 칸, 합계만 적힘)
const QUOTE = `수리 견적서
삼성화재 사고접수번호 2026-1234567
차량번호: 101호2197
작업일자 2026년 10월 3일
앞범퍼 교환 1 380,000 380,000
앞범퍼 도장  220,000
헤드램프(좌) 1 640,000
합계 1,364,000원`;

test('견적서: 보험사·접수번호·사고수리를 알아보고 공급가·부가세를 나눈다', () => {
  const r = parseRepairInvoice(QUOTE);
  assert.equal(r.insurer, '삼성화재');
  assert.equal(r.claimNo, '2026-1234567');
  assert.equal(r.kindGuess, '사고수리');
  assert.equal(r.outDate, '2026-10-03');
  assert.equal(r.lines.length, 3);
  assert.equal(r.lines[1].labor, 220000); // 도장은 공임
  assert.equal(r.lines[2].amount, 640000);
  assert.equal(r.total, 1364000);
  assert.equal(r.supply, 1240000); // 줄 합
  assert.equal(r.vat, 124000);
});

test('빈 글자는 경고만 준다', () => {
  const r = parseRepairInvoice('');
  assert.equal(r.lines.length, 0);
  assert.ok(r.warnings.length >= 1);
});

// 보험 수리비 견적서(내역서) 양식. OCR이 천 단위 쉼표를 점으로 읽고(1.000.834) 표 칸이 한 줄씩 온다
const ESTIMATE = "26.11.13.오후\n1:49\nPrint\n일반 수리비 견적서(내역서)\n차 량 번호: 101호 0000\n차 량 명칭: G90(21)-RS4\n모 델 명칭: G90\n최초 등록 일: 2022-06-23\n소 유 자:\n전 화 번호:\n주행거리\n63,778\nKM\n공 장 상호 : 케이지모빌리티성수서비스센터(주)\n(성수동2가) KGM성수서비스센터\n주 소: 서울특별시 성동구 아차산로11가길 37\n대 표 자: 홍길동\n사 업 자 번 호: 206-86-57560\n전 화 번호: 02-465-1818\n맥 스 번호: 02-465-1515\n견 적 일 자: 2026-11-13\n수리비 정산정보\n공 임\n부품\n기 타\n합 계\n탈착교환\n74,690\n순정부품\n214,100\n견 인 비\n0\n합계\n909,849\n판금수리\n77,880\n순정정산\n0%\n214,100\n구난비\n부가세\n90,985\n0\n재 료 대\n168.000\n방청부품\n0\n기타소계\n0\n도장공임\n359,310\n방청정산\n0%\n0\n할증공임\n0\n중고부품\n0\n가열건조\n15,869\n유리부품\n0\n감가상각\n0\n도장정산\n543,179\n잔 존 울\n0\n공임소계\n695,749\n부품소계\n214,100\n차감소계\n0\n합 계\n1.000.834\nNo\n작업항목 및 부품명\n작업\nH.Q%\n부품코드\n부품가격\n공임 비\n고\n1\n리어도어몰딩(좌)\n탈착\n0.38\n13.450\n2\n리어도어아웃사이드한들(좌)\n탈착\n0.07\n2.480\n3\n리어도어벨트몰딩(눈썹몰딩)(좌)\n털착\n0.16\n5,660\n4\n리어도어(좌)\n판금\n1.2\n42,480\n5\n리어컴비네이션램프(좌)\n탈착\n0.47\n16,640\n1\n6\n판금\n리어쿼터패널(연료주입구축,리어펜더,\n아우터)(좌)\n35,400\n7\n사이드스템몰딩(우)\n교환\n1.03\n36,460\n8\n리어도어(좌) 표면핀금보수\n도장\n3.82\n73,300\n135.230\n9\n리어펜더(좌) 표연판금보수\n도장\n4.43\n75,800\n156,820\n10\nU\n**부품(스태프 몰딩외2건**\n1\n214,100\n0\n11\n가열건조비\n도장\n1\n15,869\n12\n컬러매칭\n도장\n1.9\n18,900\n67.260\n이 내역서의 부품가격은 참고가격이므로 거래일 기준 실거래 가격을 확인하여 사용하시기 바랍니다.\n차량 사고일로부터 차이가 날 경우 부품가격이 부정확할 수 있으니 필히 확인하시기 바랍니나.\n상기 견적서(내역서)가 븐해 작업전에 산출된 경우 분해점검 후 부품의 종감 작업변경에 따라 견적금액이 변동될 수 있습니다.\n페이지 : 1\n1/1\nabout:blank\n";

test("보험 수리비 견적서: 정산표 합계와 작업 표를 읽는다", () => {
  const r = parseRepairInvoice(ESTIMATE);
  assert.equal(r.plateNo, "101호0000");
  assert.equal(r.mileage, 63778);
  assert.equal(r.issuedDate, "2026-11-13");
  assert.equal(r.kindGuess, "사고수리");
  assert.equal(r.laborTotal, 695749);
  assert.equal(r.partsTotal, 214100);
  assert.equal(r.supply, 909849);
  assert.equal(r.vat, 90985);
  assert.equal(r.total, 1000834);
  assert.equal(r.lines.length, 12);
  assert.equal(r.lines[0].name, "리어도어몰딩(좌) 탈착");
  assert.equal(r.lines[9].parts, 214100);
  assert.equal(r.lines.reduce((s, l) => s + l.amount, 0), 909849);
  assert.ok(!r.lines.some((l) => /차\s*량\s*번호/.test(l.name)));
  // 작업 내용 칸에는 12줄 대신 부위·작업만. (좌)=운전석, (우)=조수석. 탈착·가열건조·컬러매칭·부품 묶음은 뺀다
  assert.equal(r.summary, '운전석 뒷문·뒤 휀더 판금·도장, 조수석 사이드스텝 몰딩 교환');
  assert.deepEqual(r.warnings, []);
});
