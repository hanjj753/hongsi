import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export { escapeHtml, buildQuestionSheetHtml, type PrintableQuestionRow } from './printTemplates';

export async function openPdfDocument(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    const popup = window.open('', '_blank');
    if (!popup) throw new Error('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.');
    popup.opener = null;
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    void popup.document.fonts.ready.then(() => {
      popup.focus();
      popup.print();
    });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ html });
  }
}
