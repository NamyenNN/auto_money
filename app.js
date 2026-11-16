
/****************************************************
 * AUTO MONEY - FRONTEND APPLICATION
 * Frontend: GitHub Pages
 * Backend: Google Apps Script
 * Login: LINE LIFF
 *
 * Summary:
 * - Numeric cell = student's own price
 * - Blank cell = hide item
 * - ✅ = already approved
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

  REQUEST_TIMEOUT: 60000
};


// ==================================================
// 2. GLOBAL STATE
// ==================================================

const STATE = {
  lineUserId: 'GUEST',

  compressedBase64: '',

  members: [],

  items: [],

  isLiffReady: false,

  isSubmitting: false,

  isLoadingItems: false,

  itemRequestId: 0
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

  // ป้องกัน Cache
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
// 7. LOAD MEMBERS
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
  STATE.items = [];

  renderMembersDropdown(STATE.members);
  renderItemsCheckboxes([]);

  hideLoading();

  if (formEl) {
    formEl.classList.remove('hidden');
  }

  // ถ้าจับคู่ LINE ID ได้ ให้โหลดรายการทันที
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

  // เพิ่มเลขคำขอเพื่อป้องกันผลลัพธ์เก่าทับข้อมูลใหม่
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

    // ถ้าผู้ใช้เปลี่ยนรหัสระหว่างโหลด
    // ไม่ใช้ผลลัพธ์ของคำขอเก่า
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
// 10. RENDER PAYMENT ITEMS
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

    // แสดงเฉพาะรายการที่มีราคาถูกต้อง
    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return;
    }

    const div = document.createElement('div');

    div.className = 'checkbox-item';

    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';
    checkbox.id = item.id;
    checkbox.value = String(price);

    checkbox.dataset.title = item.title;
    checkbox.dataset.amount = String(price);

    const label = document.createElement('label');

    label.htmlFor = item.id;

    label.textContent =
      item.title +
      ' — ' +
      price.toLocaleString('en-US') +
      ' บาท';

    div.appendChild(checkbox);
    div.appendChild(label);

    container.appendChild(div);
  });

  calculateTotal();
}


// ==================================================
// 11. SETUP EVENT LISTENERS
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
        // ล้างสลิปเก่าเมื่อเปลี่ยนนักศึกษา
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
// 12. CALCULATE TOTAL AMOUNT
// ==================================================

function calculateTotal() {
  let total = 0;

  const checkedBoxes = document.querySelectorAll(
    '#itemsContainer input[type="checkbox"]:checked'
  );

  checkedBoxes.forEach(function(checkbox) {
    total += Number(checkbox.value) || 0;
  });

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

  return total;
}


// ==================================================
// 13. HANDLE IMAGE UPLOAD
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
// 14. HANDLE PAYMENT FORM SUBMISSION
// ==================================================

async function handleFormSubmit(event) {
  event.preventDefault();

  if (STATE.isSubmitting) {
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

  // เตรียมรายการที่เลือก
  const selectedItems = [];

  checkedBoxes.forEach(function(checkbox) {
    selectedItems.push({
      id: checkbox.id,
      title: checkbox.dataset.title
    });
  });

  const totalAmount = calculateTotal();

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
// 15. RESET SUBMIT BUTTON
// ==================================================

function resetSubmitButton(button) {
  STATE.isSubmitting = false;

  if (!button) return;

  button.disabled = false;

  button.textContent = 'ยืนยันการส่งสลิป';
}
