# A4 인쇄·PDF 규칙

> 화면에 보이는 문서를 **모양 그대로** A4에 맞춰 인쇄하거나 PDF로 만든다.
> 견적서, 비교견적서, 청구서, 원장 등 **인쇄·PDF가 있는 모든 표와 문서**에 이 규칙을 쓴다.
>
> 정한 날: 2026-10-07. 계기: 비교견적서를 인쇄하거나 PDF로 저장하면 표 오른쪽이 잘렸다.

## 1. 원칙

**인쇄할 때 글자·여백·칸 너비를 따로 바꾸지 않는다. 화면 폭 그대로 두고 배율(zoom)만 줄여 A4에 넣는다.**

예전 방식의 문제는 두 가지였다.

1. **화면과 종이가 달랐다.** 인쇄 전용 CSS로 글자와 여백을 줄였다.
2. **표가 잘렸다.** 문서를 A4 폭(여백 8mm면 약 733px)에 욱여넣었는데, 화면에서 900px인 표는 그 폭에 들어가지 않았다. 그래서 가로 스크롤 상자(`overflow-x: auto`)가 오른쪽을 잘라 버렸다.

지금 방식은 문서를 **화면에서 그려진 폭 그대로** 펼친 뒤, A4 한 장에 들어가는 배율을 계산해 통째로 줄인다. 그래서 화면에서 보이던 것이 종이에 그대로 찍힌다.

## 2. 구성

| 위치 | 하는 일 |
|---|---|
| `client/src/utils/printFit.js` | 배율 계산, 인쇄 창 열기, PDF 파일 만들기 |
| `client/src/index.css`의 "A4 인쇄·PDF 공통" 부분 | `.print-fit`, `.print-fit-scroll`, `.print-fit-capture`의 인쇄 규칙 |

### 함수

| 함수 | 쓰는 곳 |
|---|---|
| `printFitted(element, { orientation, marginMm, onePage, title })` | **인쇄 / PDF 다운로드 버튼.** 브라우저 인쇄 창을 연다. 인쇄 창에서 "PDF로 저장"을 고르면 같은 모양의 PDF가 된다. `title`은 저장할 때의 기본 파일 이름이다. |
| `makeFittedPdf(element, { orientation, marginMm, imageType })` | **PDF 파일(Blob)이 필요할 때.** 서버 보관이나 메일 첨부에 쓴다. 인쇄 창 없이 만든다. |
| `measurePrintFit(element, options)` | 배율만 계산한다(위 두 함수가 안에서 쓴다). |

### 설정값

| 값 | 기본 | 언제 바꾸나 |
|---|---|---|
| `orientation` | `'portrait'` (세로) | 표가 넓어 세로로는 너무 작아질 때 `'landscape'`. 예: 비교견적서는 5안 이상이면 가로 |
| `marginMm` | `8` (`PRINT_MARGIN_MM`) | 문서 안에 여백까지 그려 둔 A4 양식이면 `0`. 예: 장기렌터카 견적서 |
| `onePage` | `true` | 길이가 정해지지 않은 목록처럼 여러 장으로 나가야 하면 `false` (폭만 맞춘다) |
| `imageType` (PDF) | `'jpeg'` | 선과 작은 글자가 많은 표는 `'png'`. 예: 청구서. jpeg는 파일이 작고 png는 선명하다 |

## 3. 새 문서에 적용하는 법

**① 인쇄할 문서 덩어리에 `print-fit`, 그 안의 스크롤 상자에 `print-fit-scroll`을 단다.**

```jsx
<div className="my-doc print-fit" style={{ maxWidth: '900px', margin: '0 auto', background: '#fff' }}>
  <h2>문서 제목</h2>
  <div className="my-table-wrapper print-fit-scroll" style={{ overflowX: 'auto' }}>
    <table>…</table>
  </div>
</div>
```

**② 인쇄 버튼은 `window.print()` 대신 `printFitted`를 부른다.**

```jsx
import { printFitted, makeFittedPdf } from '../../utils/printFit.js';

<button onClick={() => printFitted(document.querySelector('.my-doc'), { title: `문서_${고객명}_${날짜}` })}>
  인쇄하기 / PDF 다운로드
</button>
```

**③ PDF 파일이 필요하면 `makeFittedPdf`를 쓴다.** 인쇄 창과 같은 `orientation`·`marginMm`를 준다.

```js
const blob = await makeFittedPdf(element, { orientation: 'portrait', marginMm: 8 });
```

**④ 그 화면의 인쇄 CSS(`@media print`)에는 다음 두 가지만 둔다.**

- 대시보드 요소(메뉴, 버튼, 다른 패널) 숨기기
- `@page { size: A4 portrait; margin: 0; }`: 용지 방향을 `orientation`과 같게 둔다. margin 0은 브라우저가 붙이는 주소·날짜 머리글을 없애기 위해서다. 종이 여백은 printFit이 둔다.

문서를 감싼 카드가 있으면 인쇄 때 `position: absolute; left: 0; top: 0; padding: 0`으로 종이 왼쪽 위에 붙인다. 문서의 위치와 여백은 printFit이 계산한다.

## 4. 하지 말 것

- ❌ `@media print` 안에서 문서의 `font-size`, `padding`, `margin`, 칸 너비를 바꾸기 → 화면과 종이가 달라진다.
- ❌ 인쇄 때 문서에 `width: 100%`를 주기 → A4 폭에 욱여넣어져 표가 잘린다. 폭은 printFit이 화면 폭으로 맞춘다.
- ❌ `html2pdf()`를 직접 부르기 → 넓은 문서의 오른쪽이 잘린다. `makeFittedPdf`를 쓴다.
- ❌ 인쇄할 문서를 `display: none`으로 숨겨 두고 PDF 만들기 → 폭이 0으로 잡힌다. 화면 밖에 두려면 `position: fixed; left: -10000px`로 둔다.
- ❌ 인쇄용과 화면용 양식을 따로 두 벌 만들기 → 한쪽만 고쳐져 달라진다. 한 양식을 화면·인쇄·PDF가 함께 쓴다.
- ❌ 화면에 고정(`position: fixed`)된 알림·팝업을 인쇄 때 그대로 두기 → 종이에 같이 찍힌다. 알림(`.toast-container`)은 `index.css`에서 이미 숨긴다. 새로 만든 고정 요소는 `no-print` class를 달아 숨긴다. (2026-10-07: 견적서 저장 직후 인쇄하면 "견적서가 저장되었습니다" 알림이 로고 위에 찍혔다)

## 5. 적용 현황

| 문서 | 파일 | 인쇄 | PDF 파일 | 상태 |
|---|---|---|---|---|
| 비교견적서 (차량 조건비교표) | `QuoteInputView.jsx` | `printFitted` (5안 이상 가로) | `makeFittedPdf` (계약자 폴더 보관) | ✅ 적용 |
| 장기렌터카 견적서 | `QuoteInputView.jsx` | `printFitted` (여백 0) | `makeFittedPdf` (여백 0) | ✅ 적용 |
| 청구서 | `InvoiceSheet.jsx` (`makeInvoicePdf`) → 월 청구, 청구서 보관함 | - | `makeFittedPdf` (png, 여백 5mm) | ✅ 적용 |
| 차량 손익 원장 | `LedgerView.jsx` 인쇄 버튼 | `window.print()`로 화면 전체를 찍음 | - | ⏳ 다음 대상: 원장 문서 부분에 `print-fit`을 달고 나머지는 숨긴다 |
| 업무 매뉴얼 | `HandbookView.jsx` 인쇄 버튼 | `window.print()`로 화면 전체를 찍음 | - | ⏳ 긴 글이라 `onePage: false`로 적용 |
| 단기렌트 단가표 | `ShortTermRatesView.jsx` | 새 창에 인쇄용 HTML을 따로 써서 인쇄 | - | ⏳ 표가 폭 100%라 잘리지는 않음. 화면 양식과 따로라 4장의 "두 벌" 문제가 있음 |

새 인쇄·PDF 기능을 만들거나 위 ⏳ 항목을 고치면 이 표를 함께 고친다.

## 6. 확인하는 법

인쇄 미리보기(인쇄 버튼 → 브라우저 인쇄 창)에서 다음을 본다.

1. 표 **오른쪽 끝 칸까지** 다 보이는가 (비교견적서는 "비고" 칸)
2. 화면과 **같은 모양**인가 (글자 크기 비율, 줄 간격, 색)
3. A4 **한 장**에 들어가고, 빈 둘째 장이 생기지 않는가 (`onePage: true`일 때)
4. 표 머리글의 남색 등 **배경색이 찍히는가**: 안 찍히면 인쇄 창의 "배경 그래픽"을 켠다
5. 저장된 PDF 파일(계약자 폴더, 청구서 첨부)도 같은 모양인가
