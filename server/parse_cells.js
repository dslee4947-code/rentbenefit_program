import XLSX from 'xlsx';

const filepath = 'C:/Users/doosi/OneDrive - CEO/Rent Benefit의 파일 - rentbenefit/rentbenefit_program/Rent Car DB/견적기/Rent Car 견적기.xlsx';

try {
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  const colsToPrint = ['A', 'D', 'E', 'H', 'I', 'J', 'N', 'O', 'R', 'S', 'T', 'U', 'Z', 'AD', 'AF', 'AH', 'AL', 'AP', 'AT'];

  console.log('Row-by-Row Layout Summary:');
  for (let r = 0; r <= 50; r++) {
    let parts = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellRef];
      if (cell) {
        const val = cell.v !== undefined ? cell.v : '';
        const formula = cell.f ? ` [=${cell.f}]` : '';
        parts.push(`${cellRef}: ${val}${formula}`);
      }
    }
    if (parts.length > 0) {
      console.log(`Row ${r + 1}:`, parts.join(' | '));
    }
  }
} catch (error) {
  console.error('Error:', error);
}
