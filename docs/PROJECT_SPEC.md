# 🧾 Wholesale Management System (MVP Spec)

## 📌 Project Overview

We are building a **basic web-based wholesale management system** for a small business.

### هدف:

* Track inventory (stock in / stock out)
* Track sales and expenses
* Automatically calculate profit/loss
* Generate simple reports

### Users:

* 2 users (Owner + Worker)

---

## 🧱 Tech Stack

### Frontend:

* React (or Next.js)
* Hosted on Vercel

### Backend:

* Firebase (Firestore Database)
* Firebase Authentication (optional for now)

---

## 🏗️ System Architecture

User → Frontend (React / Vercel) → Firebase (Firestore DB)

No custom backend server required.

---

## 📦 Core Features (MVP)

### 1. Inventory Management

* Add new product

* Fields:

  * product_id
  * name
  * category (optional)
  * cost_price
  * sale_price
  * stock_quantity
  * created_at

* Actions:

  * Add stock (stock in)
  * Reduce stock (stock out)
  * View current stock

---

### 2. Sales Management

* Record a sale

Fields:

* sale_id
* product_id
* quantity
* sale_price
* total_amount
* date

Logic:

* Reduce stock automatically
* Calculate total sale

---

### 3. Expense Tracking

* Record expenses

Fields:

* expense_id
* title (e.g. rent, transport)
* amount
* date

---

### 4. Profit / Loss Calculation

Formula:
Profit = Total Sales - Total Expenses - Cost of Goods Sold

We need:

* Daily profit
* Monthly profit

---

### 5. Dashboard (Basic)

* Total Sales Today
* Total Expenses Today
* Current Profit
* Low Stock Alert (optional)

---

## 🗃️ Firestore Database Structure

### Collection: products

* id
* name
* cost_price
* sale_price
* stock_quantity
* created_at

---

### Collection: sales

* id
* product_id
* quantity
* sale_price
* total_amount
* date

---

### Collection: expenses

* id
* title
* amount
* date

---

## 🔁 Core Logic (Important)

### When Sale Happens:

1. Fetch product
2. Reduce stock_quantity
3. Save sale record

---

### Profit Calculation:

* Sum(sales.total_amount)
* Sum(expenses.amount)
* Calculate cost using:
  cost_price * quantity sold

---

## 🎯 Development Plan

### Phase 1 (Day 1–2)

* Setup React project
* Setup Firebase
* Connect Firestore

---

### Phase 2 (Day 3–4)

* Build Inventory UI
* Add product + list products

---

### Phase 3 (Day 5–6)

* Sales system
* Stock deduction logic

---

### Phase 4 (Day 7)

* Expenses module

---

### Phase 5 (Day 8–9)

* Dashboard + reports

---

### Phase 6 (Day 10)

* Testing + bug fixes

---

## 🎨 UI Pages

* Dashboard
* Products Page
* Add Product Form
* Sales Page
* Expense Page

---

## ⚠️ Constraints

* Keep UI simple (no overdesign)
* Focus on functionality first
* No complex authentication required initially
* Optimize for mobile + desktop

---

## 🚀 Future Scope (DO NOT BUILD NOW)

* Multi-user roles
* Urdu language support
* WhatsApp reporting
* AI insights (profit trends)
* Barcode scanning

---

## 🧠 Notes for Cursor AI

* Always write clean, modular code
* Use reusable components
* Keep Firebase queries optimized
* Avoid over-engineering

---

## ✅ Definition of Done (MVP)

* Can add products
* Can record sales
* Stock updates correctly
* Can add expenses
* Can view profit/loss
