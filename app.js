
/****************************************************
 * AUTO MONEY - FRONTEND APPLICATION
 * Frontend: GitHub Pages
 * Backend: Google Apps Script
 * Login: LINE LIFF
 *
 * Features:
 * - LINE LIFF Login
 * - Dynamic Student Payment Items
 * - Payment Status: UNPAID / PENDING / APPROVED
 * - Dynamic PromptPay QR with Amount
 * - PromptPay Settings from Google Sheets
 * - Slip Upload and Compression
 * - LINE Admin Notification
 ****************************************************/


// ==================================================
// 1. CONFIGURATION
// ==================================================

const CONFIG = {
  GAS_WEB_APP_URL:
    'https://script.google.com/macros/s/AKfycby4GAoq5mkXVXWXvL4sd2eENyPUZ6XONYGzNQ3z3vXn_Ak2bJkWSW8NHKNdNnr5Quy5/exec',

  LIFF_ID: '2012645761-WmDBRWza',

  MAX_IMAGE_WIDTH: 800,
  IMAGE_QUALITY: 0.7,

  REQUEST_TIMEOUT: 60000,

  QR_SIZE: 240,

  QR_LIBRARY_URL:
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
};


// ==================================================
// 2. GLOBAL STATE
// ==================================================

const STATE = {
  lineUserId: 'GUEST',

  compressedBase64: '',

  members: [],

  items: [],

  promptPay: null,

  isLiffReady: false,

  isSubmitting: false,

  isLoadingItems: false,

  itemRequestId: 0,

  qrRenderId: 0
};


// ==================================================
// 3. INITIALIZE APPLICATION
// ==================================================

window.addEventListener(
  'DOMContentLoaded',
  async function() {
    try {
      showLoading('กำลังเชื่อมต่อระบบ...');

      const liffReady = await initLiff();

      if (liffReady === 'redirect') {
        return;
      }

      await loadAppData();

      setupEventListeners();

      ensurePromptPaySection();

      calculateTotal();

    } catch (error) {
      console.error(
        'Application Init Error:',
        error
      );

      showError(
        'เกิดข้อผิดพลาด: ' +
        (error.message || error)
      );
    }
  }
);


// ==================================================
// 4. LOADING AND ERROR UI
// ==================================================

function showLoading(message) {
  const loadingEl = document.getElementById('loading');

  if (loadingEl) {
    loadingEl.textContent =
      message || 'กำลังโหลดข้อมูล...';

    loadingEl.classList.remove('hidden');
  }
}


function hideLoading() {
  const loadingEl = document.getElementById('loading');

  if (loadingEl) {
    loadingEl.classList.add('hidden');
  }
}


function showError(message) {
  const loadingEl = document.getElementById('loading');
  const formEl = document.getElementById('paymentForm');

  if (loadingEl) {
    loadingEl.textContent = '⚠️ ' + message;
    loadingEl.classList.remove('hidden');
  }

  if (formEl) {
    formEl.classList.add('hidden');
  }
}


// ==================================================
// 5. INITIALIZE LINE LIFF
// ==================================================

async function initLiff() {
  if (
    !CONFIG.LIFF_ID ||
    typeof liff === 'undefined'
  ) {
    console.warn(
      'LIFF SDK unavailable; continuing as guest'
    );

    STATE.lineUserId = 'GUEST';

    return false;
  }

  try {
    await liff.init({
      liffId: CONFIG.LIFF_ID
    });

    if (!liff.isLoggedIn()) {
      liff.login();
      return 'redirect';
    }

    const profile = await liff.getProfile();

    if (profile && profile.userId) {
      STATE.lineUserId = profile.userId;
    }

    STATE.isLiffReady = true;

    console.log(
      'LIFF Connected:',
      STATE.lineUserId
    );

    return true;

  } catch (error) {
    console.error('LIFF Init Error:', error);

    STATE.lineUserId = 'GUEST';

    return false;
  }
}


// ==================================================
// 6. API HELPERS
// ==================================================

function buildGasUrl(params) {
  const url = new URL(CONFIG.GAS_WEB_APP_URL);

  Object.keys(params || {}).forEach(function(key) {
    url.searchParams.set(key, params[key]);
  });

  url.searchParams.set('_ts', Date.now());

  return url.toString();
}


async function fetchJson(url, options) {
  const response = await fetch(
    url,
    options || {
      method: 'GET',
      redirect: 'follow'
    }
  );

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);

  } catch (error) {
    console.error(
      'Invalid Server Response:',
      responseText.substring(0, 500)
    );

    throw new Error(
      'Apps Script ไม่ได้ส่งข้อมูล JSON กลับมา กรุณาตรวจสอบ URL และ Deployment'
    );
  }

  if (!response.ok) {
    throw new Error(
      'HTTP Error: ' + response.status
    );
  }

  if (!data || data.status === 'error') {
    throw new Error(
      (data && data.message) ||
      'ไม่สามารถโหลดข้อมูลจาก Google Sheets ได้'
    );
  }

  return data;
}


// ==================================================
// 7. LOAD MEMBERS AND PROMPTPAY SETTINGS
// ==================================================

async function loadAppData() {
  showLoading('กำลังโหลดรายชื่อสมาชิก...');

  const formEl = document.getElementById('paymentForm');

  const data = await fetchJson(
    buildGasUrl({})
  );

  if (data.status !== 'success') {
    throw new Error(
      data.message || 'ไม่สามารถโหลดข้อมูลสมาชิกได้'
    );
  }

  if (!Array.isArray(data.members)) {
    throw new Error('ไม่พบข้อมูลสมาชิกในระบบ');
  }

  STATE.members = data.members;

  STATE.promptPay = data.promptPay || null;

  STATE.items = [];

  renderMembersDropdown(STATE.members);

  renderItemsCheckboxes([]);

  ensurePromptPaySection();

  hideLoading();

  if (formEl) {
    formEl.classList.remove('hidden');
  }

  const studentSelect = document.getElementById(
    'studentSelect'
  );

  if (
    studentSelect &&
    studentSelect.value
  ) {
    await loadItemsForStudent(studentSelect.value);
  }

  console.log(
    'Members Loaded:',
    STATE.members.length
  );

  console.log(
    'PromptPay Settings Loaded:',
    !!STATE.promptPay
  );
}


// ==================================================
// 8. RENDER MEMBERS DROPDOWN
// ==================================================

function renderMembersDropdown(members) {
  const select = document.getElementById(
    'studentSelect'
  );

  if (!select) {
    throw new Error(
      'ไม่พบ studentSelect ใน HTML'
    );
  }

  select.innerHTML = '';

  const defaultOption = document.createElement('option');

  defaultOption.value = '';
  defaultOption.textContent = '-- เลือกรหัสนักศึกษา --';
  defaultOption.disabled = true;
  defaultOption.selected = true;

  select.appendChild(defaultOption);

  let matchedStudentId = '';

  members.forEach(function(member) {
    const option = document.createElement('option');

    option.value = member.studentId;
    option.dataset.name = member.name;

    option.textContent =
      member.studentId +
      ' - ' +
      member.name;

    if (
      member.lineUserId &&
      STATE.lineUserId !== 'GUEST' &&
      member.lineUserId === STATE.lineUserId
    ) {
      matchedStudentId = member.studentId;
    }

    select.appendChild(option);
  });

  if (matchedStudentId) {
    select.value = matchedStudentId;

    console.log(
      'Matched LINE User with Member'
    );
  }
}


// ==================================================
// 9. LOAD ITEMS FOR SELECTED STUDENT
// ==================================================

async function loadItemsForStudent(studentId) {
  const container = document.getElementById(
    'itemsContainer'
  );

  const requestId = ++STATE.itemRequestId;

  if (!studentId) {
    STATE.items = [];

    renderItemsCheckboxes([]);

    return;
  }

  STATE.isLoadingItems = true;

  if (container) {
    container.innerHTML =
      '<p>กำลังโหลดรายการชำระเงิน...</p>';
  }

  try {
    const data = await fetchJson(
      buildGasUrl({
        studentId: studentId
      })
    );

    if (requestId !== STATE.itemRequestId) {
      return;
    }

    if (
      data.status !== 'success' ||
      !Array.isArray(data.items)
    ) {
      throw new Error(
        data.message ||
        'ไม่สามารถโหลดรายการของนักศึกษาได้'
      );
    }

    STATE.items = data.items;

    if (data.promptPay) {
      STATE.promptPay = data.promptPay;
    }

    renderItemsCheckboxes(STATE.items);

    if (
      STATE.items.length === 0 &&
      container
    ) {
      container.innerHTML =
        '<p>ไม่มีรายการที่ต้องชำระในขณะนี้ หรือชำระครบแล้ว</p>';
    }

  } catch (error) {
    if (requestId !== STATE.itemRequestId) {
      return;
    }

    console.error(
      'Load Student Items Error:',
      error
    );

    STATE.items = [];

    renderItemsCheckboxes([]);

    if (container) {
      container.textContent =
        '⚠️ ' + error.message;
    }

  } finally {
    if (requestId === STATE.itemRequestId) {
      STATE.isLoadingItems = false;

      calculateTotal();
    }
  }
}


// ==================================================
// 10. RENDER PAYMENT ITEMS WITH STATUS
// ==================================================

function renderItemsCheckboxes(items) {
  const container = document.getElementById(
    'itemsContainer'
  );

  if (!container) {
    throw new Error(
      'ไม่พบ itemsContainer ใน HTML'
    );
  }

  container.innerHTML = '';

  if (!items || items.length === 0) {
    const message = document.createElement('p');

    message.textContent =
      'กรุณาเลือกรหัสนักศึกษาเพื่อดูรายการชำระเงิน';

    container.appendChild(message);

    calculateTotal();

    return;
  }

  items.forEach(function(item) {
    const price = Number(item.amount);

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return;
    }

    const status = item.status || '❌';

    const isApproved = status === '✅';
    const isPending = status === '⚠️';

    const canPay =
      item.canPay !== false &&
      !isApproved &&
      !isPending;

    const div = document.createElement('div');

    div.className = 'checkbox-item';

    div.style.padding = '12px';
    div.style.marginBottom = '8px';
    div.style.border = '1px solid #e5e7eb';
    div.style.borderRadius = '10px';
    div.style.boxSizing = 'border-box';

    if (!canPay) {
      div.style.backgroundColor = '#f9fafb';
      div.style.opacity = '0.85';
    }

    // Checkbox
    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';
    checkbox.id = item.id;
    checkbox.value = String(price);

    checkbox.dataset.title = item.title;
    checkbox.dataset.amount = String(price);

    // ปิดการเลือกถ้าจ่ายแล้วหรือรอตรวจสอบ
    checkbox.disabled = !canPay;

    // Label
    const label = document.createElement('label');

    label.htmlFor = item.id;

    label.textContent =
      item.title +
      ' — ' +
      price.toLocaleString('en-US') +
      ' บาท';

    // Status
    const statusElement = document.createElement('span');

    statusElement.className = 'payment-status';

    if (isApproved) {
      statusElement.textContent = '✅ จ่ายแล้ว';
      statusElement.style.color = '#16a34a';

    } else if (isPending) {
      statusElement.textContent = '⚠️ รอตรวจสอบ';
      statusElement.style.color = '#d97706';

    } else {
      statusElement.textContent = '❌ ยังไม่จ่าย';
      statusElement.style.color = '#dc2626';
    }

    statusElement.style.display = 'block';
    statusElement.style.fontSize = '13px';
    statusElement.style.fontWeight = '600';
    statusElement.style.marginTop = '5px';

    // เพิ่มองค์ประกอบ
    div.appendChild(checkbox);
    div.appendChild(label);
    div.appendChild(statusElement);

    container.appendChild(div);
  });

  calculateTotal();
}


// ==================================================
// 11. PROMPTPAY QR - CRC16
// ==================================================

function crc16(data) {
  let crc = 0xFFFF;

  for (let i = 0; i < data.length; i++) {
    crc ^= (data.charCodeAt(i) << 8);

    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }

  return crc
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
}


// ==================================================
// 12. PROMPTPAY QR - TLV HELPER
// ==================================================

function makeTLV(tag, value) {
  const text = String(value);

  if (text.length > 99) {
    throw new Error('ข้อมูล QR ยาวเกินกำหนด');
  }

  return (
    tag +
    String(text.length).padStart(2, '0') +
    text
  );
}


// ==================================================
// 13. GENERATE PROMPTPAY PAYLOAD
// ==================================================

function generatePromptPayPayload(target, amount) {
  const sanitized = String(target || '')
    .replace(/\D/g, '');

  let targetType = '';
  let formattedTarget = '';

  // PromptPay Mobile
  if (
    sanitized.length === 10 &&
    sanitized.startsWith('0')
  ) {
    targetType = '01';

    formattedTarget =
      '0066' + sanitized.substring(1);

  // Thai Citizen ID / Tax ID
  } else if (sanitized.length === 13) {
    targetType = '02';

    formattedTarget = sanitized;

  } else {
    throw new Error(
      'เลข PromptPay ต้องเป็นเบอร์โทรศัพท์ 10 หลัก หรือเลขประจำตัว 13 หลัก'
    );
  }

  const paymentAmount = Number(amount);

  if (
    !Number.isFinite(paymentAmount) ||
    paymentAmount <= 0
  ) {
    throw new Error('ยอดเงินไม่ถูกต้อง');
  }

  const amountText = paymentAmount.toFixed(2);

  const merchantAccount =
    makeTLV('00', 'A000000677010111') +
    makeTLV(targetType, formattedTarget);

  const tag29 = makeTLV('29', merchantAccount);

  let payload =
    '000201' +
    '010212' +
    tag29 +
    '5303764' +
    makeTLV('54', amountText) +
    '5802TH';

  payload += '6304';

  payload += crc16(payload);

  return payload;
}


// ==================================================
// 14. LOAD QR CODE LIBRARY
// ==================================================

function loadQRCodeLibrary() {
  return new Promise(function(resolve, reject) {
    if (typeof QRCode !== 'undefined') {
      resolve();
      return;
    }

    const existingScript = document.querySelector(
      'script[data-promptpay-qrcode]'
    );

    if (existingScript) {
      existingScript.addEventListener(
        'load',
        function() {
          if (typeof QRCode !== 'undefined') {
            resolve();
          } else {
            reject(new Error('โหลด QR Code Library ไม่สำเร็จ'));
          }
        },
        { once: true }
      );

      existingScript.addEventListener(
        'error',
        function() {
          reject(new Error('ไม่สามารถโหลด QR Code Library ได้'));
        },
        { once: true }
      );

      return;
    }

    const script = document.createElement('script');

    script.src = CONFIG.QR_LIBRARY_URL;
    script.async = true;
    script.dataset.promptpayQrcode = 'true';

    script.onload = function() {
      if (typeof QRCode !== 'undefined') {
        resolve();
      } else {
        reject(new Error('ไม่พบ QRCode Library'));
      }
    };

    script.onerror = function() {
      reject(
        new Error('ไม่สามารถเชื่อมต่อ QR Code Library ได้')
      );
    };

    document.head.appendChild(script);
  });
}


// ==================================================
// 15. CREATE PROMPTPAY SECTION
// ==================================================

function ensurePromptPaySection() {
  let section = document.getElementById(
    'promptPaySection'
  );

  if (section) {
    return section;
  }

  const itemsContainer = document.getElementById(
    'itemsContainer'
  );

  if (!itemsContainer) {
    return null;
  }

  section = document.createElement('section');

  section.id = 'promptPaySection';

  section.style.display = 'none';
  section.style.margin = '20px 0';
  section.style.padding = '20px';
  section.style.border = '1px solid #e5e7eb';
  section.style.borderRadius = '16px';
  section.style.background = '#ffffff';
  section.style.textAlign = 'center';
  section.style.boxSizing = 'border-box';

  const heading = document.createElement('h3');

  heading.textContent = 'ชำระเงินผ่าน PromptPay';

  heading.style.margin = '0 0 8px';
  heading.style.fontSize = '18px';
  heading.style.fontWeight = '700';
  heading.style.color = '#111827';

  const description = document.createElement('p');

  description.id = 'promptPayDescription';

  description.textContent =
    'สแกน QR Code เพื่อชำระเงิน';

  description.style.fontSize = '13px';
  description.style.color = '#6b7280';
  description.style.margin = '0 0 16px';

  const qrContainer = document.createElement('div');

  qrContainer.id = 'promptPayQRCode';

  qrContainer.style.width = CONFIG.QR_SIZE + 'px';
  qrContainer.style.minHeight = CONFIG.QR_SIZE + 'px';
  qrContainer.style.maxWidth = '100%';
  qrContainer.style.margin = '0 auto 16px';
  qrContainer.style.display = 'flex';
  qrContainer.style.justifyContent = 'center';
  qrContainer.style.alignItems = 'center';

  const accountName = document.createElement('div');

  accountName.id = 'promptPayAccountName';

  accountName.style.fontSize = '15px';
  accountName.style.fontWeight = '700';
  accountName.style.color = '#111827';
  accountName.style.marginBottom = '6px';

  const amountText = document.createElement('div');

  amountText.id = 'promptPayAmount';

  amountText.style.fontSize = '28px';
  amountText.style.fontWeight = '800';
  amountText.style.color = '#16a34a';
  amountText.style.marginBottom = '12px';

  const note = document.createElement('p');

  note.id = 'promptPayNote';

  note.textContent =
    'กรุณาตรวจสอบชื่อบัญชีและยอดเงินก่อนชำระ';

  note.style.fontSize = '12px';
  note.style.color = '#6b7280';
  note.style.margin = '0';

  section.appendChild(heading);
  section.appendChild(description);
  section.appendChild(qrContainer);
  section.appendChild(accountName);
  section.appendChild(amountText);
  section.appendChild(note);

  itemsContainer.insertAdjacentElement(
    'afterend',
    section
  );

  return section;
}


// ==================================================
// 16. RENDER PROMPTPAY QR
// ==================================================

async function renderPromptPayQR(amount) {
  const section = ensurePromptPaySection();

  if (!section) {
    return;
  }

  const qrContainer = document.getElementById(
    'promptPayQRCode'
  );

  const accountName = document.getElementById(
    'promptPayAccountName'
  );

  const amountText = document.getElementById(
    'promptPayAmount'
  );

  const description = document.getElementById(
    'promptPayDescription'
  );

  const note = document.getElementById(
    'promptPayNote'
  );

  const renderId = ++STATE.qrRenderId;

  if (!Number.isFinite(amount) || amount <= 0) {
    section.style.display = 'none';

    if (qrContainer) {
      qrContainer.innerHTML = '';
    }

    return;
  }

  section.style.display = 'block';

  if (!STATE.promptPay) {
    qrContainer.textContent =
      'ไม่พบข้อมูล PromptPay กรุณาตรวจสอบชีตตั้งค่า';

    accountName.textContent = '';
    amountText.textContent = '';

    return;
  }

  try {
    const payload = generatePromptPayPayload(
      STATE.promptPay.promptPay,
      amount
    );

    if (accountName) {
      accountName.textContent =
        'ชื่อบัญชี: ' + STATE.promptPay.accountName;
    }

    if (amountText) {
      amountText.textContent =
        '฿' + amount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
    }

    if (description) {
      description.textContent =
        'สแกน QR Code เพื่อชำระยอดตามรายการที่เลือก';
    }

    if (note) {
      note.textContent =
        'QR นี้ระบุยอดเงินไว้แล้ว กรุณาตรวจสอบชื่อบัญชีก่อนยืนยันการโอน';
    }

    qrContainer.innerHTML = '';

    qrContainer.textContent = 'กำลังสร้าง QR Code...';

    await loadQRCodeLibrary();

    if (renderId !== STATE.qrRenderId) {
      return;
    }

    qrContainer.innerHTML = '';

    new QRCode(qrContainer, {
      text: payload,
      width: CONFIG.QR_SIZE,
      height: CONFIG.QR_SIZE,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    console.log(
      'PromptPay QR Generated:',
      amount
    );

  } catch (error) {
    if (renderId !== STATE.qrRenderId) {
      return;
    }

    console.error(
      'PromptPay QR Error:',
      error
    );

    qrContainer.textContent =
      '⚠️ ' + error.message;

    if (description) {
      description.textContent =
        'ไม่สามารถสร้าง QR Code ได้ กรุณาลองใหม่';
    }
  }
}


// ==================================================
// 17. CALCULATE TOTAL AMOUNT
// ==================================================

function calculateTotal() {
  let total = 0;

  const checkedBoxes = document.querySelectorAll(
    '#itemsContainer input[type="checkbox"]:checked'
  );

  checkedBoxes.forEach(function(checkbox) {
    total += Number(checkbox.value) || 0;
  });

  total = Number(total.toFixed(2));

  const totalElement = document.getElementById(
    'totalAmount'
  );

  if (totalElement) {
    totalElement.textContent =
      total.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
  }

  renderPromptPayQR(total);

  return total;
}


// ==================================================
// 18. SETUP EVENT LISTENERS
// ==================================================

function setupEventListeners() {
  const itemsContainer = document.getElementById(
    'itemsContainer'
  );

  const slipInput = document.getElementById(
    'slipInput'
  );

  const paymentForm = document.getElementById(
    'paymentForm'
  );

  const studentSelect = document.getElementById(
    'studentSelect'
  );

  if (studentSelect) {
    studentSelect.addEventListener(
      'change',
      function() {
        STATE.compressedBase64 = '';

        const preview = document.getElementById(
          'preview'
        );

        if (preview) {
          preview.src = '';
          preview.classList.add('hidden');
        }

        if (slipInput) {
          slipInput.value = '';
        }

        STATE.items = [];

        renderItemsCheckboxes([]);

        loadItemsForStudent(
          studentSelect.value
        );
      }
    );
  }

  if (itemsContainer) {
    itemsContainer.addEventListener(
      'change',
      calculateTotal
    );
  }

  if (slipInput) {
    slipInput.addEventListener(
      'change',
      handleImageUpload
    );
  }

  if (paymentForm) {
    paymentForm.addEventListener(
      'submit',
      handleFormSubmit
    );
  }

  console.log('Event Listeners Ready');
}


// ==================================================
// 19. HANDLE IMAGE UPLOAD
// ==================================================

function handleImageUpload(event) {
  const file = event.target.files[0];

  if (!file) {
    STATE.compressedBase64 = '';
    return;
  }

  if (!file.type.startsWith('image/')) {
    alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');

    event.target.value = '';

    STATE.compressedBase64 = '';

    return;
  }

  const reader = new FileReader();

  reader.onload = function(readerEvent) {
    const img = new Image();

    img.onload = function() {
      try {
        const canvas = document.createElement('canvas');

        let width = img.width;
        let height = img.height;

        if (width > CONFIG.MAX_IMAGE_WIDTH) {
          const ratio =
            CONFIG.MAX_IMAGE_WIDTH / width;

          width = CONFIG.MAX_IMAGE_WIDTH;

          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');

        if (!ctx) {
          throw new Error(
            'ไม่สามารถประมวลผลรูปภาพได้'
          );
        }

        ctx.drawImage(
          img,
          0,
          0,
          width,
          height
        );

        STATE.compressedBase64 = canvas.toDataURL(
          'image/jpeg',
          CONFIG.IMAGE_QUALITY
        );

        const preview = document.getElementById(
          'preview'
        );

        if (preview) {
          preview.src = STATE.compressedBase64;

          preview.classList.remove('hidden');
        }

        console.log(
          'Image Compressed Successfully'
        );

      } catch (error) {
        console.error(
          'Image Compression Error:',
          error
        );

        alert(
          'ไม่สามารถบีบอัดรูปภาพได้ กรุณาลองใหม่'
        );

        STATE.compressedBase64 = '';
      }
    };

    img.onerror = function() {
      alert(
        'ไม่สามารถอ่านรูปภาพได้ กรุณาเลือกรูปใหม่'
      );

      STATE.compressedBase64 = '';
    };

    img.src = readerEvent.target.result;
  };

  reader.onerror = function() {
    alert('ไม่สามารถอ่านไฟล์ได้');

    STATE.compressedBase64 = '';
  };

  reader.readAsDataURL(file);
}


// ==================================================
// 20. HANDLE PAYMENT FORM SUBMISSION
// ==================================================

async function handleFormSubmit(event) {
  event.preventDefault();

  if (STATE.isSubmitting) {
    return;
  }

  if (STATE.isLoadingItems) {
    alert('กรุณารอโหลดรายการชำระเงินให้เสร็จก่อน');
    return;
  }

  if (!STATE.compressedBase64) {
    alert('กรุณาแนบรูปสลิปการโอนเงิน');
    return;
  }

  const select = document.getElementById(
    'studentSelect'
  );

  if (!select || !select.value) {
    alert('กรุณาเลือกรหัสนักศึกษา');
    return;
  }

  const selectedOption =
    select.options[select.selectedIndex];

  const studentId = select.value;
  const name = selectedOption.dataset.name;

  if (!name) {
    alert('ไม่พบข้อมูลชื่อสมาชิก');
    return;
  }

  const checkedBoxes = document.querySelectorAll(
    '#itemsContainer input[type="checkbox"]:checked'
  );

  if (checkedBoxes.length === 0) {
    alert(
      'กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการชำระ'
    );

    return;
  }

  const selectedItems = [];

  checkedBoxes.forEach(function(checkbox) {
    selectedItems.push({
      id: checkbox.id,
      title: checkbox.dataset.title
    });
  });

  // ตรวจสอบสถานะจากข้อมูลที่โหลดไว้ก่อนส่ง
  const invalidSelection = selectedItems.find(function(selected) {
    const item = STATE.items.find(function(current) {
      return current.id === selected.id;
    });

    return !item ||
      item.status === '⚠️' ||
      item.status === '✅' ||
      item.canPay === false;
  });

  if (invalidSelection) {
    alert(
      'มีรายการที่กำลังรอตรวจสอบหรือชำระแล้ว กรุณาโหลดรายการใหม่'
    );

    await loadItemsForStudent(studentId);
    return;
  }

  const totalAmount = calculateTotal();

  if (totalAmount <= 0) {
    alert('ยอดชำระเงินไม่ถูกต้อง');
    return;
  }

  if (!STATE.promptPay) {
    alert('ไม่พบข้อมูล PromptPay กรุณาติดต่อผู้ดูแลระบบ');
    return;
  }

  const btn = document.getElementById(
    'submitBtn'
  );

  if (!btn) {
    alert('ไม่พบปุ่มส่งข้อมูล');
    return;
  }

  STATE.isSubmitting = true;

  btn.disabled = true;

  btn.textContent = 'กำลังอัปโหลดข้อมูล...';

  const payload = {
    action: 'submit_payment',

    lineUserId: STATE.lineUserId,

    studentId: studentId,

    name: name,

    selectedItems: selectedItems,

    selectedItemsNames: selectedItems.map(
      function(item) {
        return item.title;
      }
    ).join(', '),

    totalAmount: totalAmount,

    imageBase64: STATE.compressedBase64
  };

  try {
    const controller = new AbortController();

    const timeout = setTimeout(
      function() {
        controller.abort();
      },
      CONFIG.REQUEST_TIMEOUT
    );

    let response;

    try {
      response = await fetch(
        CONFIG.GAS_WEB_APP_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },

          body: JSON.stringify(payload),

          redirect: 'follow',

          signal: controller.signal
        }
      );

    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();

    let result;

    try {
      result = JSON.parse(responseText);

    } catch (parseError) {
      console.error(
        'Invalid POST Response:',
        responseText.substring(0, 500)
      );

      throw new Error(
        'เซิร์ฟเวอร์ส่งข้อมูลกลับมาไม่ถูกต้อง กรุณาตรวจสอบ Apps Script'
      );
    }

    if (!response.ok) {
      throw new Error(
        'HTTP Error: ' + response.status
      );
    }

    if (result.status === 'success') {
      alert(
        '✅ ส่งสลิปเรียบร้อยแล้ว!\n\n' +
        'รหัสรายการ: ' + result.txId + '\n' +
        'ชื่อ: ' + result.name + '\n' +
        'ยอดชำระ: ' +
        Number(result.totalAmount).toLocaleString('en-US') +
        ' บาท\n\n' +
        'กรุณารอแอดมินตรวจสอบ'
      );

      if (result.notificationWarning) {
        console.warn(
          result.notificationWarning
        );
      }

      if (
        typeof liff !== 'undefined' &&
        liff.isInClient()
      ) {
        liff.closeWindow();

      } else {
        location.reload();
      }

    } else {
      throw new Error(
        result.message ||
        'ไม่สามารถส่งข้อมูลได้'
      );
    }

  } catch (error) {
    console.error(
      'Submit Error:',
      error
    );

    if (error.name === 'AbortError') {
      alert(
        'การเชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจสอบสถานะรายการก่อนส่งซ้ำ'
      );

    } else {
      alert(
        'เกิดข้อผิดพลาด: ' + error.message
      );
    }

    resetSubmitButton(btn);
  }
}


// ==================================================
// 21. RESET SUBMIT BUTTON
// ==================================================

function resetSubmitButton(button) {
  STATE.isSubmitting = false;

  if (!button) return;

  button.disabled = false;

  button.textContent = 'ยืนยันการส่งสลิป';
}
