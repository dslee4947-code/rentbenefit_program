import XLSX from 'xlsx';

const file = 'c:/Users/doosi/OneDrive - CEO/Rent Benefit의 파일 - rentbenefit/청구자동화/데이터/청구원본데이터.xlsx';

try {
  const workbook = XLSX.readFile(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet);
  
  console.log('--- FIRST 5 ROWS ---');
  rawRows.slice(0, 5).forEach((row, i) => {
    console.log(`Row ${i}:`, row);
  });
} catch (err) {
  console.error(`Failed to read:`, err.message);
}
