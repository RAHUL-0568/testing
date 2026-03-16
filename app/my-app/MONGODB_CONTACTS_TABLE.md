# MongoDB contacts table (collection) – setup and queries

Use database **`cray`** and collection **`contacts`**. The app creates the collection on first insert; you can create it and add an index manually with the commands below.

---

## 1. Create the collection (optional)

In **MongoDB Compass** or **mongosh**, connect with your Atlas connection string, then:

```javascript
use cray
db.createCollection("contacts")
```

---

## 2. Create index (faster contact list by user)

Run once so listing contacts by `userId` is fast:

```javascript
use cray
db.contacts.createIndex({ userId: 1 })
db.contacts.createIndex({ createdAt: -1 })
```

---

## 3. Queries to see your contacts

**All contacts in the app (all users):**
```javascript
use cray
db.contacts.find().sort({ createdAt: -1 })
```

**Count contacts:**
```javascript
use cray
db.contacts.countDocuments()
```

**Contacts for a specific user (replace USER_ID with the hashed userId from your app):**
```javascript
use cray
db.contacts.find({ userId: "USER_ID" }).sort({ createdAt: -1 })
```

**Pretty list (name, phone, email, when added):**
```javascript
use cray
db.contacts.find(
  {},
  { name: 1, phone: 1, email: 1, countryCode: 1, createdAt: 1, _id: 0 }
).sort({ createdAt: -1 })
```

---

## Document shape (what the app stores)

Each document in `contacts` looks like:

| Field        | Type   | Description                    |
|-------------|--------|--------------------------------|
| `userId`    | string | Hashed user id from accessToken |
| `name`      | string | Contact name                   |
| `phone`     | string | Full number (e.g. +15551234567) |
| `email`     | string | Optional email                 |
| `countryCode` | string | e.g. +1, +91                  |
| `createdAt` | Date   | When the contact was added     |

When you add a contact in the app (“Save & Next”), it is inserted into `cray.contacts`. The dashboard loads the list from this collection, so whatever you add is visible after refresh or on the “no-contacts” / contact list view.
