# Quick Start: Using the Whisky Alert System

## For End Users (Discord)

### Adding Alerts

**Alert for a specific distillery:**
```
/alert-add type:distillery value:Ardbeg
/alert-add type:distillery value:Laphroaig
/alert-add type:distillery value:Glenfiddich
```

**Alert for a specific region:**
```
/alert-add type:region value:Islay
/alert-add type:region value:Speyside
/alert-add type:region value:Highland
```

**Alert for minimum age:**
```
/alert-add type:age value:15
/alert-add type:age value:20
/alert-add type:age value:25
```

### Managing Alerts

**View all your alerts:**
```
/alert-list
```

**Remove an alert (get ID from /alert-list):**
```
/alert-remove id:5
```

### What Happens Next?

1. Your alert is saved in the database
2. When the scraper runs and finds new whiskies, it checks your alerts
3. If a new whisky matches your criteria, you'll receive a **private DM** with:
   - Whisky name and details
   - Price, ABV, age
   - Direct link to buy
   - Which alert triggered the notification

## For Developers/Admins

### First Time Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your database and Discord bot token
   ```

3. **Start the application:**
   ```bash
   npm run start:dev
   ```

4. **Initialize database:**
   ```bash
   curl http://localhost:3000/postgres/init
   ```

5. **Verify bot is online:**
   - Check Discord server
   - Slash commands should appear when typing `/`

### Running the Scraper

**Manually trigger scraper:**
```bash
curl http://localhost:3000/scraper/run
```

**The scraper will:**
1. Scrape all whiskies from SMWS website
2. Compare with database to find new entries
3. Save new whiskies to database
4. Check all user alerts
5. Send DM notifications for matches

### Monitoring

**Check database connection:**
```bash
curl http://localhost:3000/postgres/connection
```

**Check tables exist:**
```bash
curl http://localhost:3000/postgres/tables
```

**View logs:**
```bash
# Application logs will show:
# - Discord bot connection
# - Slash command registration
# - Scraper progress
# - Alert matches
# - Notification delivery
```

### Troubleshooting

**Slash commands not appearing:**
- Verify bot token is correct in `.env`
- Check bot has correct permissions
- Restart the application
- Wait a few minutes (Discord can take time to sync)

**Alerts not triggering:**
- Check scraper logs for "Checking alerts"
- Verify new whiskies are being detected
- Ensure alert type/value matches whisky data
- Check Discord DM privacy settings

**Bot can't send DMs:**
- User must share a server with the bot
- User must allow DMs from server members
- Bot needs "Send Messages" permission

## Alert Matching Examples

### Distillery Match
```
Alert: distillery = "Ardbeg"
Matches: Any whisky where distillery name is "Ardbeg" (case-insensitive)
```

### Region Match
```
Alert: region = "Islay"
Matches: Any whisky from the Islay region (case-insensitive)
```

### Age Match
```
Alert: age = "15"
Matches: Any whisky aged 15 years or older (18, 20, 25 would all match)
```

## Common Use Cases

### "I only want Islay whiskies"
```
/alert-add type:region value:Islay
```

### "Alert me for any old whisky"
```
/alert-add type:age value:20
```

### "I love Ardbeg"
```
/alert-add type:distillery value:Ardbeg
```

### "Multiple alerts for my favorites"
```
/alert-add type:distillery value:Ardbeg
/alert-add type:distillery value:Laphroaig
/alert-add type:region value:Islay
/alert-add type:age value:18
```

## Tips

- ✅ Alerts are persistent (stay active until you remove them)
- ✅ You can have multiple alerts at once
- ✅ Each alert is checked against every new whisky
- ✅ Notifications are private (DM only to you)
- ✅ Alert values are case-insensitive
- ✅ Age alerts use "greater than or equal" logic
- ❌ Can't combine multiple criteria in one alert (yet)
- ❌ Can't alert on price ranges (yet)

## Support

Need help? Check the full documentation:
- [ALERTS_DOCUMENTATION.md](./ALERTS_DOCUMENTATION.md) - Complete technical documentation
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Developer implementation details
- [README.md](./README.md) - General project information
