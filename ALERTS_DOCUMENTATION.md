# Whisky Alert System Documentation

## Overview

The alert system allows Discord users to register alerts for new whiskies matching specific criteria. When the scraper detects new whiskies matching user alerts, it automatically sends DM notifications to the users.

## Discord Bot Commands

### `/alert-add`
Register a new whisky alert.

**Parameters:**
- `type` (required): The type of alert
  - `distillery`: Alert when a whisky from a specific distillery is found
  - `region`: Alert when a whisky from a specific region is found
  - `age`: Alert when a whisky of at least X years age is found
- `value` (required): The value to match against
  - For distillery: The distillery name (e.g., "Ardbeg", "Laphroaig")
  - For region: The region name (e.g., "Islay", "Speyside", "Highland")
  - For age: Minimum age in years (e.g., "15", "20")

**Examples:**
```
/alert-add type:distillery value:Ardbeg
/alert-add type:region value:Islay
/alert-add type:age value:15
```

### `/alert-list`
List all your active alerts.

**Example:**
```
/alert-list
```

**Output:**
Shows all your alerts with their IDs, types, and values.

### `/alert-remove`
Remove an alert by its ID.

**Parameters:**
- `id` (required): The alert ID to remove (get this from `/alert-list`)

**Example:**
```
/alert-remove id:5
```

## How It Works

1. **User registers an alert** using `/alert-add`
2. **Scraper runs** periodically and detects new whiskies
3. **Alert matching** happens automatically:
   - Distillery alerts: Exact match (case-insensitive)
   - Region alerts: Exact match (case-insensitive)
   - Age alerts: Whisky age >= specified minimum age
4. **Notifications sent** via Discord DM to matching users
5. **Alert persists** until manually removed with `/alert-remove`

## Database Schema

### `user_alerts` Table

```sql
CREATE TABLE user_alerts (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  guild_id VARCHAR(100) NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  alert_value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_alert UNIQUE(user_id, guild_id, alert_type, alert_value)
);
```

## Alert Notification Format

When an alert matches, users receive a DM with:
- 🥃 Whisky name
- 🏭 Distillery
- 🌍 Region
- 📅 Age
- 💰 Price
- 🔥 ABV
- 🔗 Direct link to product page
- Footer showing which alert matched

## Technical Implementation

### Key Files Modified

1. **`discord.service.ts`**
   - Added slash command registration
   - Implemented command handlers (`/alert-add`, `/alert-list`, `/alert-remove`)
   - Created `sendAlertNotification()` method for DM notifications
   - Added `getAllAlerts()` to fetch alerts from database

2. **`scraper.service.ts`**
   - Added `checkAlertsAndNotify()` method
   - Integrated alert checking into main scraper flow
   - Checks new whiskies against all active alerts
   - Sends notifications for matches

3. **`postgres.service.ts`**
   - Added `user_alerts` table creation
   - Updated `checkTablesExist()` to include alerts table

### Alert Matching Logic

```typescript
// Distillery match
isMatch = whisky.distillery?.toLowerCase() === alert.alert_value.toLowerCase();

// Region match
isMatch = whisky.region?.toLowerCase() === alert.alert_value.toLowerCase();

// Age match (greater than or equal)
const minAge = parseInt(alert.alert_value);
const whiskyAge = parseInt(whisky.age);
isMatch = whiskyAge >= minAge;
```

## Privacy & Permissions

- Alerts are **per-user per-guild** (same user can have different alerts in different servers)
- Users can only view and remove their own alerts
- Notifications are sent via **DM** (private messages)
- No alert data is shared between users

## Future Enhancements

Potential improvements:
- Alert for specific price ranges
- Alert for ABV ranges
- Alert for cask types
- Weekly digest of all matches instead of instant notifications
- Alert expiration dates
- Maximum number of alerts per user
