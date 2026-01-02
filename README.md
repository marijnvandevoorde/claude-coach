# Claude Coach

In this repo, you'll find a tool that allows Claude to read all your health data and activities from Garmin Connect - and then creates custom-tailored training programs for triathlons, marathons, and other endurance activities. It'll ask the user for three main inputs:

1. The target event and a date (Example: Ironman 70.3 Oceanside, March 29th 2026)
2. Access to the user's activities and health data
3. Unstructured guidance to keep in mind when creating the training plan (like upcoming vacations, inability to train specific sports because of travel, injuries, etc)

Goals:

- Garmin Connect data should be read in a way that's end-user friendly. We don't want to host anything, so we probably can't create an official integration. We need to find an easy, convenient, and straightforward way to grab the raw data from Garmin Connect.
- The Garmin Connect data should then end up in a SQLite database. The point of the database is to make it very easy for Claude's model to quickly and in a token-efficient way get a good idea of the user's activities, performance, and general athletic condition.
- The actual coaching ought to be done by a "Claude Skill" that can be used from Claude Code and Claude.ai. This skill should teach Claude how to query the SQLite database. It should also describe the output format for training plans. For now, we'll use simple Markdown files.
