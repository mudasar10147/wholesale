# 🚀 Wholesale Management System — Phase-Based Development Plan

## 🎯 Goal

Build a working MVP in **10 structured phases**, starting from scratch (Phase 0) to a complete usable system (Phase 10).

Each phase is:

* Small
* Testable
* Cursor-friendly

---

# 🧱 Phase 0 — Project Initialization (Hello World)

### Objective:

Set up basic frontend and confirm deployment works.

### Tasks:

* Create React / Next.js project
* Push to GitHub
* Deploy on Vercel
* Show simple page:

  * "Wholesale Management System"

### Output:

* Live working URL
* Basic UI running

---

# 🔌 Phase 1 — Firebase Setup

### Objective:

Connect app with Firebase

### Tasks:

* Create Firebase project
* Enable Firestore
* Add Firebase config to project
* Test connection by writing dummy data

### Output:

* Data successfully written to Firestore

---

# 🗃️ Phase 2 — Database Structure

### Objective:

Create core collections

### Tasks:

* Create collections:

  * products
  * sales
  * expenses
* Define schema (fields)

### Output:

* Structured Firestore DB ready

---

# 📦 Phase 3 — Product Management (Basic)

### Objective:

Add and view products

### Tasks:

* Create "Add Product" form
* Save product to Firestore
* Create "Products List" page

### Output:

* Products can be added and displayed

---

# 📊 Phase 4 — Inventory Logic

### Objective:

Track stock properly

### Tasks:

* Add stock_quantity field
* Implement:

  * Stock In
  * Stock Out
* Update UI to reflect stock changes

### Output:

* Inventory updates correctly

---

# 💰 Phase 5 — Sales Module

### Objective:

Record sales and reduce stock

### Tasks:

* Create "Add Sale" form
* Select product
* Enter quantity
* Save sale in DB

### Logic:

* Reduce product stock automatically

### Output:

* Sales recorded + stock updated

---

# 💸 Phase 6 — Expense Module

### Objective:

Track business expenses

### Tasks:

* Create "Add Expense" form
* Save expenses in DB
* List all expenses

### Output:

* Expenses recorded and visible

---

# 📈 Phase 7 — Profit Calculation

### Objective:

Calculate profit/loss

### Tasks:

* Calculate:

  * Total Sales
  * Total Expenses
  * Cost of Goods Sold
* Show:

  * Daily profit
  * Monthly profit

### Output:

* Profit/loss displayed correctly

---

# 📊 Phase 8 — Dashboard

### Objective:

Central overview page

### Tasks:

* Create dashboard UI
* Show:

  * Total Sales Today
  * Total Expenses Today
  * Profit Today
  * Stock summary

### Output:

* Basic business overview screen

---

# ⚠️ Phase 9 — Validation & Stability

### Objective:

Make system reliable

### Tasks:

* Add form validation
* Prevent negative stock
* Handle errors (Firebase failures)
* Clean UI/UX

### Output:

* Stable, usable system

---

# 🚀 Phase 10 — MVP Finalization

### Objective:

Polish and finalize MVP

### Tasks:

* Improve UI (clean layout)
* Mobile responsiveness
* Basic navigation (menu/sidebar)
* Final testing

### Output:

* Fully working MVP ready for daily use

---

# 🧠 Instructions for Cursor AI

When working on this project:

* Always follow current phase only
* Do NOT skip phases
* Keep code simple and modular
* Test each phase before moving forward
* Use reusable components

---

# ✅ Definition of Completion

The MVP is complete when:

* Products can be managed
* Sales reduce stock automatically
* Expenses are tracked
* Profit/loss is visible
* Dashboard shows business status

---

# 🔥 Development Strategy

* Build fast
* Avoid overengineering
* Focus on business value
* Iterate after MVP

---
