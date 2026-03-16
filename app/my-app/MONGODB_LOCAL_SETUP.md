# MongoDB on localhost (Mac)

Your app is already configured to use **mongodb://localhost:27017** (see `.env.local`).  
You just need to install and start MongoDB on your Mac.

## 1. Install MongoDB

In Terminal, run:

```bash
brew tap mongodb/brew
brew install mongodb-community
```

## 2. Start MongoDB

```bash
brew services start mongodb-community
```

Check it’s running:

```bash
brew services list
```

You should see `mongodb-community` with status **started**.

## 3. Connect

- **MongoDB Compass:** use connection string `mongodb://localhost:27017` → Connect.
- **This app:** already uses that URL. Restart the app if it was running:

  ```bash
  npm run dev
  ```

## Useful commands

| Action        | Command |
|---------------|--------|
| Start MongoDB | `brew services start mongodb-community` |
| Stop MongoDB  | `brew services stop mongodb-community`  |
| Restart       | `brew services restart mongodb-community` |
| Status        | `brew services list` |

After MongoDB is running, the **cray** database and **contacts** collection will be created when you add a contact in the app.
