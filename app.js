
/****************************************************
 * AUTO MONEY - FRONTEND APPLICATION
 * Frontend: GitHub Pages
 * Backend: Google Apps Script
 * Login: LINE LIFF
 * Database: Google Sheets
 ****************************************************/


// ==================================================
// 1. CONFIGURATION
// ==================================================

const CONFIG = {

  // GOOGLE APPS SCRIPT
  GAS_WEB_APP_URL:
    'https://script.google.com/macros/s/AKfycby4GAoq5mkXVXWXvL4sd2eENyPUZ6XONYGzNQ3z3vXn_Ak2bJkWSW8NHKNdNnr5Quy5/exec',

  // LINE LIFF
  LIFF_ID: '2012645761-WmDBRWza',

  // IMAGE SETTINGS
  MAX_IMAGE_WIDTH: 800,
  IMAGE_QUALITY: 0.7,

  // REQUEST SETTINGS
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

  isSubmitting: false

};


// ==================================================
// 3. INITIALIZE APPLICATION
// ==================================================

window.addEventListener('DOMContentLoaded', async function() {

  try {

    showLoading('กำลังเชื่อมต่อระบบ...');

    // เชื่อมต่อ LINE LIFF
    const liffReady = await initLiff();

    // ถ้ากำลัง redirect ไปหน้า Login ให้หยุดก่อน
    if (liffReady === 'redirect') {
      return;
    }

    // โหลดข้อมูลจาก Google Sheets
    await loadAppData();

    // ผูก Event ต่าง ๆ
    setupEventListeners();

  } catch (error) {

    console.error('Application Init Error:', error);

    showError(
      'ไม่สามารถเริ่มต้นระบบได้ กรุณาลองใหม่อีกครั้ง'
    );

  }

});


// ==================================================
// 4. LOADING AND ERROR UI
// ==================================================

function showLoading(message) {

  const loadingEl = document.getElementById('loading');

  if (loadingEl) {

    loadingEl.textContent = message || 'กำลังโหลดข้อมูล...';

    loadingEl.classList.remove('hidden');

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

  if (!CONFIG.LIFF_ID) {

    console.warn('LIFF ID is not configured');

    STATE.lineUserId = 'GUEST';

    return false;

  }


  if (typeof liff === 'undefined') {

    console.warn('LINE LIFF SDK not found');

    STATE.lineUserId = 'GUEST';

    return false;

  }


  try {

    await liff.init({

      liffId: CONFIG.LIFF_ID

    });


    // ตรวจสอบ Login

    if (!liff.isLoggedIn()) {

      liff.login();

      return 'redirect';

    }


    // ดึงข้อมูล LINE Profile

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
// 6. LOAD DATA FROM GOOGLE APPS SCRIPT
// ==================================================

async function loadAppData() {

  showLoading('กำลังโหลดรายชื่อสมาชิกและรายการชำระเงิน...');

  const loadingEl = document.getElementById('loading');

  const formEl = document.getElementById('paymentForm');


  try {

    const response = await fetch(
      CONFIG.GAS_WEB_APP_URL,
      {
        method: 'GET',
        redirect: 'follow'
      }
    );


    const responseText = await response.text();

    let data;


    // ตรวจสอบ JSON

    try {

      data = JSON.parse(responseText);

    } catch (parseError) {

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


    if (data.status !== 'success') {

      throw new Error(
        data.message || 'ไม่สามารถโหลดข้อมูลจาก Google Sheets ได้'
      );

    }


    if (!Array.isArray(data.members)) {

      throw new Error(
        'ไม่พบข้อมูลสมาชิกในระบบ'
      );

    }


    if (!Array.isArray(data.items)) {

      throw new Error(
        'ไม่พบรายการชำระเงินในระบบ'
      );

    }


    // เก็บข้อมูลไว้ใน STATE

    STATE.members = data.members;

    STATE.items = data.items;


    // แสดงรายชื่อสมาชิก

    renderMembersDropdown(STATE.members);


    // แสดงรายการชำระเงิน

    renderItemsCheckboxes(STATE.items);


    // ซ่อน Loading

    if (loadingEl) {

      loadingEl.classList.add('hidden');

    }


    // แสดงฟอร์ม

    if (formEl) {

      formEl.classList.remove('hidden');

    }


    console.log('App Data Loaded Successfully');

    console.log('Members:', STATE.members.length);

    console.log('Items:', STATE.items.length);


  } catch (error) {

    console.error('Load Data Error:', error);

    showError(error.message);

    throw error;

  }

}


// ==================================================
// 7. RENDER MEMBERS DROPDOWN
// ==================================================

function renderMembersDropdown(members) {

  const select = document.getElementById('studentSelect');

  if (!select) {

    throw new Error(
      'ไม่พบ studentSelect ใน HTML'
    );

  }


  // ล้างข้อมูลเดิม

  select.innerHTML = '';


  // ตัวเลือกเริ่มต้น

  const defaultOption = document.createElement('option');

  defaultOption.value = '';

  defaultOption.textContent = '-- เลือกรหัสนักศึกษา --';

  defaultOption.disabled = true;

  defaultOption.selected = true;

  select.appendChild(defaultOption);


  let matchedMember = false;


  members.forEach(function(member) {

    const option = document.createElement('option');

    option.value = member.studentId;

    option.dataset.name = member.name;

    option.textContent =
      member.studentId + ' - ' + member.name;


    // ตรวจสอบ LINE USER ID

    if (
      member.lineUserId &&
      STATE.lineUserId !== 'GUEST' &&
      member.lineUserId === STATE.lineUserId
    ) {

      option.selected = true;

      matchedMember = true;

    }


    select.appendChild(option);

  });


  // ถ้าพบสมาชิกที่ตรงกับ LINE ID
  // ให้เลือกสมาชิกคนนั้นอัตโนมัติ

  if (matchedMember) {

    console.log('Matched LINE User with Member');

  }

}


// ==================================================
// 8. RENDER PAYMENT ITEMS
// ==================================================

function renderItemsCheckboxes(items) {

  const container = document.getElementById('itemsContainer');

  if (!container) {

    throw new Error(
      'ไม่พบ itemsContainer ใน HTML'
    );

  }


  // ล้างรายการเดิม

  container.innerHTML = '';


  if (items.length === 0) {

    const message = document.createElement('p');

    message.textContent = 'ยังไม่มีรายการชำระเงิน';

    container.appendChild(message);

    return;

  }


  items.forEach(function(item) {

    const title = String(item.title || '');

    // อ่านราคาจากวงเล็บ เช่น ค่าห้อง (300)

    const priceMatch = title.match(
      /\(([\d,]+(?:\.\d+)?)\)/
    );

    const price = priceMatch
      ? Number(priceMatch[1].replace(/,/g, ''))
      : 0;


    const div = document.createElement('div');

    div.className = 'checkbox-item';


    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';

    checkbox.id = item.id;

    checkbox.value = String(price);

    checkbox.dataset.title = title;


    const label = document.createElement('label');

    label.htmlFor = item.id;

    label.textContent = title;


    div.appendChild(checkbox);

    div.appendChild(label);

    container.appendChild(div);

  });


  calculateTotal();

}


// ==================================================
// 9. SETUP EVENT LISTENERS
// ==================================================

function setupEventListeners() {

  const itemsContainer = document.getElementById('itemsContainer');

  const slipInput = document.getElementById('slipInput');

  const paymentForm = document.getElementById('paymentForm');


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
// 10. CALCULATE TOTAL AMOUNT
// ==================================================

function calculateTotal() {

  let total = 0;

  const checkedBoxes = document.querySelectorAll(
    '#itemsContainer input[type="checkbox"]:checked'
  );


  checkedBoxes.forEach(function(checkbox) {

    const price = Number(checkbox.value) || 0;

    total += price;

  });


  const totalElement = document.getElementById('totalAmount');

  if (totalElement) {

    totalElement.textContent = total.toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }
    );

  }


  return total;

}


// ==================================================
// 11. HANDLE IMAGE UPLOAD
// ==================================================

function handleImageUpload(event) {

  const file = event.target.files[0];

  if (!file) {

    STATE.compressedBase64 = '';

    return;

  }


  // ตรวจสอบประเภทไฟล์

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


        // ปรับขนาดรูป

        if (width > CONFIG.MAX_IMAGE_WIDTH) {

          const ratio = CONFIG.MAX_IMAGE_WIDTH / width;

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


        // บีบอัดเป็น JPEG

        STATE.compressedBase64 = canvas.toDataURL(
          'image/jpeg',
          CONFIG.IMAGE_QUALITY
        );


        // แสดง Preview

        const preview = document.getElementById('preview');

        if (preview) {

          preview.src = STATE.compressedBase64;

          preview.classList.remove('hidden');

        }


        console.log('Image Compressed Successfully');


      } catch (error) {

        console.error('Image Compression Error:', error);

        alert('ไม่สามารถบีบอัดรูปภาพได้ กรุณาลองใหม่');

        STATE.compressedBase64 = '';

      }

    };


    img.onerror = function() {

      alert('ไม่สามารถอ่านรูปภาพได้ กรุณาเลือกรูปใหม่');

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
// 12. HANDLE PAYMENT FORM SUBMISSION
// ==================================================

async function handleFormSubmit(event) {

  event.preventDefault();


  // ป้องกันการส่งซ้ำ

  if (STATE.isSubmitting) {

    return;

  }


  // ตรวจสอบรูปสลิป

  if (!STATE.compressedBase64) {

    alert('กรุณาแนบรูปสลิปการโอนเงิน');

    return;

  }


  // ตรวจสอบสมาชิก

  const select = document.getElementById('studentSelect');

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


  // ตรวจสอบรายการชำระเงิน

  const checkedBoxes = document.querySelectorAll(
    '#itemsContainer input[type="checkbox"]:checked'
  );


  if (checkedBoxes.length === 0) {

    alert('กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการชำระ');

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


  // คำนวณยอดรวมเพื่อแสดงผล
  // Backend จะคำนวณยอดจริงอีกครั้งจาก Google Sheets

  const totalAmount = calculateTotal();


  // ตรวจสอบปุ่ม

  const btn = document.getElementById('submitBtn');

  if (!btn) {

    alert('ไม่พบปุ่มส่งข้อมูล');

    return;

  }


  STATE.isSubmitting = true;

  btn.disabled = true;

  btn.textContent = 'กำลังอัปโหลดข้อมูล...';


  // สร้าง Payload ให้ตรงกับ Code.gs

  const payload = {

    action: 'submit_payment',

    lineUserId: STATE.lineUserId,

    studentId: studentId,

    name: name,

    selectedItems: selectedItems,

    selectedItemsNames: selectedItems.map(function(item) {

      return item.title;

    }).join(', '),

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


    // ตรวจสอบ JSON Response

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


      // ปิดหน้า LIFF หรือ Reload หน้าเว็บ

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
        result.message || 'ไม่สามารถส่งข้อมูลได้'
      );

    }


  } catch (error) {

    console.error('Submit Error:', error);


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
// 13. RESET SUBMIT BUTTON
// ==================================================

function resetSubmitButton(button) {

  STATE.isSubmitting = false;

  if (!button) return;

  button.disabled = false;

  button.textContent = 'ยืนยันการส่งสลิป';

}
