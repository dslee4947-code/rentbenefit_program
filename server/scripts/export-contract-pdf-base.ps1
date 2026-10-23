# 전자계약서 엑셀 양식에서 'PDF 바탕' 두 벌을 뽑는다. (Excel이 설치된 Windows PC에서 실행)
#
#   blank.pdf  : 값 칸(수식 칸)을 모두 비운 계약서 12쪽. 서버가 이 위에 계약 값을 찍는다.
#   marker.pdf : 값 칸마다 고유 표시(C001, C002 …)를 넣은 같은 12쪽. 표시가 찍힌 자리를 읽어 '값 자리 지도'를 만든다.
#
# 엑셀이 직접 만든 PDF라 글꼴·선·도형·직인이 원본 계약서와 똑같다.
# 원본 엑셀은 건드리지 않는다. 복사본을 열어 값을 바꾸고 저장하지 않고 닫는다.
#
# 사용:
#   powershell -File export-contract-pdf-base.ps1 -Xlsx <양식.xlsx> -Cells <bound-cells.json> -OutDir <폴더>
#   (bound-cells.json: [{token, sheet, a}] — scripts/build-contract-pdf-template.js가 만든다)
param(
  [Parameter(Mandatory = $true)][string]$Xlsx,
  [Parameter(Mandatory = $true)][string]$Cells,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string[]]$Sheets = @('계약서_1', '계약서_2', '계약서_3', '계약서_4', '계약서_5', '계약서_6', '계약서_7', '계약서_8', '계약서_9', '계약서_10', '계약서_11', '계약서_12')
)
$ErrorActionPreference = 'Stop'
$cellList = Get-Content -Raw -Encoding UTF8 $Cells | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutDir | Out-Null

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
try {
  foreach ($mode in @('blank', 'marker')) {
    $copy = Join-Path $OutDir "work-$mode.xlsx"
    Copy-Item -Force $Xlsx $copy
    # UpdateLinks 0: 렌트_차량관리 엑셀(외부 연결)을 찾지 않는다
    $wb = $excel.Workbooks.Open($copy, 0, $false)
    # 수동 계산: 값을 바꾼 뒤 수식이 다시 계산돼 덮이지 않게. 설정이 안 되는 환경도 있어 실패해도 넘어간다
    # (값 칸의 수식은 아래에서 글자로 덮어쓰므로 다시 계산돼도 바뀌지 않는다)
    try { $excel.Calculation = -4135 } catch { }
    foreach ($c in $cellList) {
      $ws = $wb.Worksheets.Item($c.sheet)
      $text = if ($mode -eq 'marker') { $c.token } else { '' }
      $ws.Range($c.a).NumberFormat = '@'
      $ws.Range($c.a).Value2 = $text
    }
    foreach ($ws in $wb.Worksheets) {
      $ws.Visible = if ($Sheets -contains $ws.Name) { -1 } else { 0 }
    }
    $pdf = Join-Path $OutDir "$mode.pdf"
    # 0 = xlTypePDF. 보이는 장만, 각 장의 인쇄 설정(쪽 맞춤·여백) 그대로
    $wb.ExportAsFixedFormat(0, $pdf, 0, $true, $false)
    $wb.Close($false)
    Write-Output "만듦: $pdf"
  }
} finally {
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
