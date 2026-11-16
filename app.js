// === 1. ตั้งค่าการเชื่อมต่อ (แก้ไขข้อมูลของคุณตรงนี้) ===
const CONFIG = {
  GAS_WEB_APP_URL: 'ใส่_WEB_APP_URL_ของ_APPS_SCRIPT',
  LIFF_ID: 'ใส่_LIFF_ID_ของคุณ', // ปล่อยว่างไว้ได้ถ้ายังไม่ได้สร้าง LIFF
  MAX_IMAGE_WIDTH: 800,           // ความกว้างสูงสุดของรูปสลิปหลังบีบอัด (px)
  IMAGE_QUALITY: 0.7              // คุณภาพไฟล์ JPEG (0.1 - 1.0)
};

// ตัวแปรเก็บสถานะของระบบ
const STATE = {
  lineUserId: 'GUEST',
  compressedBase64: ''
};

// === 2. เริ่มต้นทำงานเมื่อโหลดหน้าเว็บเสร็จ ===
window.addEventListener('DOMContentLoaded', async () => {
  await initLiff();
  await loadAppData();
  setupEventListeners();
});

// เชื่อมต่อ LINE LIFF เพื่อดึง User ID
async function initLiff() {
  if (!CONFIG.LIFF_ID || CONFIG.LIFF_ID.includes('ใส่_')) return;
  try {
    await liff.init({ liffId: CONFIG.LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login();
    } else {
      const profile = await liff.getProfile();
      STATE.lineUserId = profile.userId;
    }
  } catch (err) {
    console.error('LIFF Init Error:', err);
  }
}

// ดึงรายชื่อสมาชิกและรายการเก็บเงินจาก Google Sheets
async function loadAppData() {
  const loadingEl = document.getElementById('loading');
  const formEl = document.getElementById('paymentForm');

  try {
    const response = await fetch(CONFIG.GAS_WEB_APP_URL);
    const data = await response.json();

    renderMembersDropdown(data.members);
    renderItemsCheckboxes(data.items);

    loadingEl.classList.add('hidden');
    formEl.classList.remove('hidden');
  } catch (err) {
    loadingEl.textContent = '⚠️ ไม่สามารถโหลดข้อมูลได้ กรุณาตรวจสอบ URL ของ Apps Script';
    console.error('Load Data Error:', err);
  }
}

// สร้างตัวเลือกใน Dropdown รายชื่อ
function renderMembersDropdown(members) {
  const select = document.getElementById('studentSelect');
  members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.studentId;
    opt.dataset.name = m.name;
    opt.textContent = `${m.studentId} - ${m.name}`;
    
    // เลือกชื่อให้อัตโนมัติถ้า LINE User ID ตรงกับฐานข้อมูล
    if (m.lineUserId === STATE.lineUserId && STATE.lineUserId !== 'GUEST') {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

// สร้างรายการ Checkbox จากหัวตาราง Summary
function renderItemsCheckboxes(items) {
  const container = document.getElementById('itemsContainer');
  items.forEach(item => {
    // ดึงตัวเลขราคาจากในวงเล็บ เช่น "ค่าห้อง (200)" -> 200
    const priceMatch = item.title.match(/\((.*?)\)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) || 0 : 0;

    const div = document.createElement('div');
    div.className = 'checkbox-item';
    div.innerHTML = `
      <input type="checkbox" id="${item.id}" value="${price}" data-title="${item.title}">
      <label for="${item.id}">${item.title}</label>
    `;
    container.appendChild(div);
  });
}

// ผูก Event การกดปุ่มและเลือกไฟล์
function setupEventListeners() {
  // คำนวณเงินใหม่ทุกครั้งที่ติ๊ก Checkbox
  document.getElementById('itemsContainer').addEventListener('change', calculateTotal);
  
  // บีบอัดรูปทันทีที่เลือกไฟล์สลิป
  document.getElementById('slipInput').addEventListener('change', handleImageUpload);
  
  // จัดการตอนกดปุ่มส่งฟอร์ม
  document.getElementById('paymentForm').addEventListener('submit', handleFormSubmit);
}

// คำนวณยอดเงินรวม
function calculateTotal() {
  let total = 0;
  const checkedBoxes = document.querySelectorAll('#itemsContainer input[type="checkbox"]:checked');
  checkedBoxes.forEach(cb => {
    total += parseFloat(cb.value);
  });
  document.getElementById('totalAmount').textContent = total;
}

// ย่อขนาดและบีบอัดไฟล์รูปภาพด้วย HTML5 Canvas
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > CONFIG.MAX_IMAGE_WIDTH) {
        height *= CONFIG.MAX_IMAGE_WIDTH / width;
        width = CONFIG.MAX_IMAGE_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      STATE.compressedBase64 = canvas.toDataURL('image/jpeg', CONFIG.IMAGE_QUALITY);
      
      const preview = document.getElementById('preview');
      preview.src = STATE.compressedBase64;
      preview.classList.remove('hidden');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// ส่งข้อมูลทั้งหมดไปที่ Google Apps Script
async function handleFormSubmit(e) {
  e.preventDefault();
  if (!STATE.compressedBase64) return alert('กรุณาแนบรูปสลิปการโอนเงิน');

  const select = document.getElementById('studentSelect');
  const studentId = select.value;
  const name = select.options[select.selectedIndex].dataset.name;
  
  const checkedBoxes = document.querySelectorAll('#itemsContainer input[type="checkbox"]:checked');
  if (checkedBoxes.length === 0) {
    return alert('กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการชำระ');
  }

  const selectedItems = [];
  const itemsNamesArr = [];
  checkedBoxes.forEach(cb => {
    selectedItems.push({ id: cb.id, title: cb.dataset.title });
    itemsNamesArr.push(cb.dataset.title);
  });

  const totalAmount = parseFloat(document.getElementById('totalAmount').textContent);
  const btn = document.getElementById('submitBtn');
  
  btn.disabled = true;
  btn.textContent = 'กำลังอัปโหลดข้อมูล...';

  const payload = {
    action: 'submit_payment',
    lineUserId: STATE.lineUserId,
    studentId: studentId,
    name: name,
    selectedItems: selectedItems,
    selectedItemsNames: itemsNamesArr.join(', '),
    totalAmount: totalAmount,
    imageBase64: STATE.compressedBase64
  };

  try {
    const response = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (result.status === 'success') {
      alert('✅ ส่งสลิปเรียบร้อยแล้ว! กรุณารอแอดมินตรวจสอบ');
      if (typeof liff !== 'undefined' && liff.isInClient()) {
        liff.closeWindow();
      } else {
        location.reload();
      }
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.message);
      resetSubmitButton(btn);
    }
  } catch (error) {
    alert('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    console.error('Submit Error:', error);
    resetSubmitButton(btn);
  }
}

function resetSubmitButton(btn) {
  btn.disabled = false;
  btn.textContent = 'ยืนยันการส่งสลิป';
}
