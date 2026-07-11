function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents || '{}');
    var expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!expected || data.secret !== expected) return output({ ok: false, error: 'Brak dostępu' });
    if (!data.to || !data.subject || !data.textBody) return output({ ok: false, error: 'Brak danych wiadomości' });
    MailApp.sendEmail({
      to: data.to,
      subject: data.subject,
      body: data.textBody,
      htmlBody: data.htmlBody || data.textBody,
      name: 'Panel Floty'
    });
    return output({ ok: true });
  } catch (error) {
    return output({ ok: false, error: String(error.message || error) });
  }
}

function output(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
