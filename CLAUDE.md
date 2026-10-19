# rentbenefit_program

## 인쇄·PDF

인쇄하거나 PDF로 만드는 문서(견적서, 비교견적서, 청구서, 원장 등 모든 표와 문서)는 `docs/print-a4-guide.md`를 따른다.
화면 모양 그대로 A4에 맞춰 배율만 줄인다. `client/src/utils/printFit.js`의 `printFitted` / `makeFittedPdf`를 쓰고, `window.print()`나 `html2pdf()`를 직접 부르지 않는다.
