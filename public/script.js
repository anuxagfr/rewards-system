// ===== Init Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCAcVmMBM5cuXmydgj3LpunqXgjPVWW2SI",
  authDomain: "reward-20359.firebaseapp.com",
  projectId: "reward-20359",
  storageBucket: "reward-20359.firebasestorage.app",
  messagingSenderId: "577324459963",
  appId: "1:577324459963:web:d969522318bcb229ae869e",
  measurementId: "G-TX647FT78R"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
let allUsersData = {}; // Map of userId -> userData for easy lookup
let allBillsDocs = []; // To hold all bill documents for rendering

// // ===== Auth Guard
auth.onAuthStateChanged(async (user) => {
  if (!user) { location.href = 'index.html'; return; }
  const snap = await db.collection('users').doc(user.uid).get();
  if (!snap.exists || snap.data().role !== 'admin') {
    alert("Access denied. Admins only.");
    auth.signOut();
  } else {
    document.getElementById('adminEmail').textContent = user.email;
    subscribeInbox();
    subscribeBills();
    subscribeUsers();
  }
});

// ===== Logout
document.getElementById('logoutBtn').onclick = () => auth.signOut();

// ===== Inbox
function subscribeInbox(){
  db.collection('admin_inbox').orderBy('createdAt','desc')
    .onSnapshot(snap=>{
      const tbody = document.getElementById('inboxTable');
      tbody.innerHTML = '';
      snap.forEach(doc=>{
        const d = doc.data();
        const date = d.createdAt ? d.createdAt.toDate().toLocaleString() : '-';

        const tr = tbody.insertRow(); // Create a new row
        tr.insertCell().textContent = d.billNo;
        tr.insertCell().textContent = `₹${d.amount}`;
        tr.insertCell().textContent = d.userEmail;
        tr.insertCell().textContent = date;

        const actionCell = tr.insertCell();
        const approveBtn = document.createElement('button');
        approveBtn.className = 'btn btn-approve';
        approveBtn.textContent = 'Approve';
        approveBtn.onclick = async ()=>{
          approveBtn.disabled = true;
          rejectBtn.disabled = true;
          try {
            await addBillAndMaybeCredit(d.billNo, d.amount, d.userId, d.userEmail);
            
            // After approving, find and delete ALL requests for this bill number
            const inboxQuerySnap = await db.collection('admin_inbox').where('billNo', '==', d.billNo).get();
            const deletePromises = [];
            inboxQuerySnap.forEach(inboxDoc => {
                deletePromises.push(inboxDoc.ref.delete());
            });
            await Promise.all(deletePromises);
          } catch (error) {
            console.error("Error approving request:", error);
            alert("Failed to approve request. See console for details.");
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
          }
        };

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn btn-reject';
        rejectBtn.textContent = 'Reject';
        rejectBtn.onclick = async ()=>{
          rejectBtn.disabled = true;
          approveBtn.disabled = true;
          try {
            await db.collection('admin_inbox').doc(doc.id).delete();
          } catch (error) {
            console.error("Error rejecting request:", error);
            alert("Failed to reject request. See console for details.");
            rejectBtn.disabled = false;
            approveBtn.disabled = false;
          }
        };
        actionCell.append(approveBtn, rejectBtn);
      });
    });
}

// ===== Helper: Add Bill (with optional auto-credit)
async function addBillAndMaybeCredit(billNo, amount, userId=null, userEmail=null){
  const billRef = db.collection('bills').doc(billNo);
  const billSnap = await billRef.get();
  if (billSnap.exists) return; // already exists

  await billRef.set({
    billNo, amount,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    claimedBy: userId || null
  });

  // Auto-credit points if user is linked
  if (userId) {
    const points = Math.floor(amount * 0.01);
    const uRef = db.collection('users').doc(userId);
    await db.runTransaction(async (tx) => {
      const uSnap = await tx.get(uRef);
      const curPts = (uSnap.exists && uSnap.data().points) ? uSnap.data().points : 0;
      tx.update(uRef, { points: curPts + points });
      tx.set(uRef.collection("claims").doc(), {
        billNo, amount, points,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  }
}

// Renders the bills table using the latest data
function renderBillsTable() {
  const tbody = document.getElementById('billsTable');
  tbody.innerHTML = '';
  let totalAmt = 0;
  allBillsDocs.forEach(doc => {
    const d = doc.data();
    totalAmt += d.amount || 0;
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString() : '-';
    const status = d.claimedBy ? "✅ Claimed" : "⏳ Available";

    const claimedById = d.claimedBy;
    let claimedByDisplay = '-';
    if (claimedById) {
      const user = allUsersData[claimedById];
      // If user is found, show name or email; otherwise, show the ID.
      claimedByDisplay = (user && (user.name || user.email)) || claimedById;
    }

    const tr = tbody.insertRow();
    tr.insertCell().textContent = d.billNo;

    const amountCell = tr.insertCell();
    amountCell.textContent = '₹';
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.value = d.amount;
    amountInput.style.width = '80px';
    amountCell.appendChild(amountInput);

    tr.insertCell().textContent = status;
    tr.insertCell().textContent = claimedByDisplay;
    tr.insertCell().textContent = date;

    const actionCell = tr.insertCell();
    const updateBtn = document.createElement('button');
    updateBtn.className = 'btn btn-edit';
    updateBtn.textContent = 'Update';
    actionCell.appendChild(updateBtn);

    updateBtn.onclick = async () => {
      updateBtn.disabled = true;
      const newAmt = parseFloat(amountInput.value);

      try {
        if (isNaN(newAmt) || newAmt <= 0) {
          throw new Error("Invalid amount entered.");
        }

        const billRef = db.collection('bills').doc(doc.id);
        const billSnap = await billRef.get();
        if (!billSnap.exists) throw new Error("Bill does not exist anymore.");

        const bill = billSnap.data();

        if (!bill.claimedBy) {
          // Case 1: Update an unclaimed bill.
          await billRef.update({ amount: newAmt });
          alert('Bill amount updated successfully.');
        } else {
          // Case 2: Update a claimed bill (and user points).
          const userId = bill.claimedBy;
          const uRef = db.collection('users').doc(userId);
          const oldPoints = Math.floor((bill.amount || 0) * 0.01);
          const newPoints = Math.floor(newAmt * 0.01);
          const diff = newPoints - oldPoints;

          // IMPORTANT: Query for the claim doc *before* the transaction.
          const claimsRef = uRef.collection("claims");
          const claimQuerySnap = await claimsRef.where("billNo", "==", bill.billNo).limit(1).get();
          const claimDocRef = !claimQuerySnap.empty ? claimQuerySnap.docs[0].ref : null;

          await db.runTransaction(async (tx) => {
            const uSnap = await tx.get(uRef);
            const curPts = (uSnap.exists && uSnap.data().points) ? uSnap.data().points : 0;

            tx.update(uRef, { points: curPts + diff });
            tx.update(billRef, { amount: newAmt });

            if (claimDocRef) {
              tx.update(claimDocRef, {
                amount: newAmt, points: newPoints,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            }
          });
          alert(`Bill updated. User’s points adjusted by ${diff}. New total points for this claim: ${newPoints}.`);
        }
      } catch (error) {
        console.error("Error updating bill:", error);
        alert(`Failed to update bill: ${error.message}`);
      } finally {
        updateBtn.disabled = false;
      }
    };
  });
  document.getElementById('statAmount').textContent = "₹" + totalAmt;
}

// ===== Bills DB
function subscribeBills(){
  db.collection('bills').orderBy('createdAt','desc')
    .onSnapshot(snap=>{
      allBillsDocs = snap.docs;
      renderBillsTable();
    });
}

// ===== Users DB
function subscribeUsers(){
  db.collection('users').orderBy('email').onSnapshot(snap=>{
    allUsersData = {};
    let totalPts = 0, totalUsers = 0;
    snap.forEach(doc=>{
      allUsersData[doc.id] = doc.data();
      totalPts += doc.data().points || 0;
      totalUsers++;
    });
    document.getElementById('statUsers').textContent = totalUsers;
    document.getElementById('statPoints').textContent = totalPts;
    renderUsersTable(); // Initial render of the users table
    renderBillsTable(); // Re-render bills table to update names
  });
}

// Renders the users table, applying the current search filter
function renderUsersTable() {
  const tbody = document.getElementById('usersTable');
  const searchTerm = document.getElementById('userSearch').value.toLowerCase();
  tbody.innerHTML = ''; // Clear existing rows

  // Create an array of user objects that includes their ID for operations
  const filteredUsers = Object.entries(allUsersData)
    .filter(([id, user]) => user.email && user.email.toLowerCase().includes(searchTerm))
    .map(([id, data]) => ({ id, ...data }));

  filteredUsers.forEach(d => {
    const tr = tbody.insertRow();
    const nameCell = tr.insertCell();
    nameCell.textContent = d.name || '-';

    // Add a label and management options for admin users
    if (d.role === 'admin') {
      const adminLabel = document.createElement('span');
      adminLabel.className = 'admin-label';
      adminLabel.textContent = 'Admin';
      nameCell.appendChild(adminLabel);

      // Add a "Remove Admin" button, but not for the currently logged-in user
      if (d.id !== auth.currentUser.uid) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-remove-admin';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = async () => {
          if (!confirm(`Are you sure you want to remove admin rights from ${d.email}?`)) {
            return;
          }
          removeBtn.disabled = true;
          try {
            // Remove the role field from the user's document
            await db.collection('users').doc(d.id).update({
              role: firebase.firestore.FieldValue.delete()
            });
          } catch (error) {
            console.error("Error removing admin rights:", error);
            alert(`Failed to remove admin rights: ${error.message}`);
            removeBtn.disabled = false;
          }
        };
        nameCell.appendChild(removeBtn);
      }
    }

    tr.insertCell().textContent = d.email;
    tr.insertCell().textContent = d.phone || '-';
    tr.insertCell().textContent = d.points || 0;
  });
}

// ===== Add Bill manually
document.getElementById('addBillBtn').onclick = async ()=>{
  const billNo = document.getElementById('newBillNo').value.trim();
  const amount = parseFloat(document.getElementById('newBillAmt').value);
  const msg = document.getElementById('addBillMsg');
  msg.textContent="";
  if(!billNo || isNaN(amount) || amount<=0){
    msg.style.color="#dc3545"; msg.textContent="Enter valid bill details."; return;
  }
  try{
    await addBillAndMaybeCredit(billNo, amount);
    // clean from inbox if exists
    const inboxSnap = await db.collection('admin_inbox').where("billNo","==",billNo).get();
    inboxSnap.forEach(async (doc)=> await db.collection('admin_inbox').doc(doc.id).delete());
    msg.style.color="#28a745"; msg.textContent="Bill added successfully!";
    document.getElementById('newBillNo').value="";
    document.getElementById('newBillAmt').value="";
  }catch(e){
    msg.style.color="#dc3545"; msg.textContent=e.message;
  }
};

// Add event listener for the user search bar
document.getElementById('userSearch').addEventListener('input', renderUsersTable);

// ===== Make another user an admin
document.getElementById('makeAdminBtn').onclick = async () => {
  const email = document.getElementById('newAdminEmail').value.trim();
  const msg = document.getElementById('addAdminMsg');
  const btn = document.getElementById('makeAdminBtn');
  msg.textContent = "";

  if (!email) {
    msg.style.color = "#dc3545";
    msg.textContent = "Please enter a user's email address.";
    return;
  }

  btn.disabled = true;
  try {
    // Find the user by email. Note: This requires a Firestore index.
    const userQuery = await db.collection('users').where('email', '==', email).limit(1).get();

    if (userQuery.empty) {
      throw new Error(`User with email '${email}' not found.`);
    }

    const userDoc = userQuery.docs[0];
    if (userDoc.data().role === 'admin') {
      msg.style.color = "#007bff";
      msg.textContent = "This user is already an admin.";
      return; // Not an error, just stop.
    }

    await userDoc.ref.update({ role: 'admin' });
    msg.style.color = "#28a745";
    msg.textContent = `Success! '${email}' is now an admin.`;
    document.getElementById('newAdminEmail').value = "";
  } catch (error) {
    msg.style.color = "#dc3545";
    msg.textContent = error.message;
  } finally {
    btn.disabled = false;
  }
};