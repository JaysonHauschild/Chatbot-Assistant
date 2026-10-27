# Dashboard User Guide

This guide is for OKSBDC staff who review chatbot conversations and maintain its answers. The dashboard lets you review feedback, investigate suspicious messages, change instructions and message-filter rules, and restore earlier content.

## Sign in and find your way around

1. Open your organization's chatbot host followed by `/chatbot/dashboard`. Use the production or staging address supplied by your administrator.
2. Enter your **Username** and **Password**, then select **Log In**. For a new account, use the temporary password supplied privately by your administrator and complete the setup below. Contact your administrator for an account or password replacement; the dashboard has no self-service account creation or password-reset screen.
3. Use **Light Mode** or **Dark Mode** if desired. Choose a section from the left sidebar; the sections available depend on your account role. Select the hamburger button (**Expand navigation**) to show section names, or **Collapse navigation** to return to the icon menu. Select **Monthly analytics**, **Management**, or **Administration** to expand links to its subtabs; select a link to open that view. Select the same section again to hide its links. The selected link stays in sync with the subtabs in the main panel. On phones, the expanded menu closes when you choose a subtab link or a section without subtabs. Escape also closes it.
4. Select **Log Out** when finished. Sign-in normally survives a page refresh in the same tab; the session expires after eight hours and may end sooner if an administrator resets access.

**Unsaved changes** appears when you edit chatbot instructions, a message rule, a conversation review, account setup, a new dashboard user, or a user role. Leaving an edited form asks for confirmation. Cancel keeps you on the form; confirming leaves without saving. Management and Administration drafts remain available when switching their areas, but conversation review drafts are lost when their view is replaced. Successful saves clear the indicator; failed saves keep it. Refreshing or closing the page requests the browser’s standard warning while any draft remains unsaved.

Unsaved drafts are not preserved across a page reload or logout. Keep a working copy in your organization's approved private workspace if you need to resume later. Open the visitor chat in a separate tab when testing so you can keep your dashboard draft open.

### Understand your access

| Account role | Available actions |
| --- | --- |
| **Read-only** | View Overview, Conversations, and Monthly analytics; read review history; search, filter, explore charts, and export reports. Review notes/statuses and archive/restore controls cannot be changed. |
| **Editor** | All viewing actions, plus conversation reviews, archiving/restoring conversations, and Management tools for instructions, rules, and response review. |
| **Administrator** | All editor actions, plus Administration for user accounts and the dashboard audit log. |

Accounts with viewing access show a **Read-only** badge. Contact an administrator if you need a different role.

### Complete first-time account setup

New accounts open **Set up your account** before any dashboard content is available.

1. Enter your **First name**, **Last name**, and work **Email**. All three are required. Names may contain up to 100 characters each.
2. Choose a **New password** of at least 12 characters (maximum 1,024), different from the temporary password. Enter it again in **Confirm new password**.
3. Select **Complete account setup**. When the save succeeds, the dashboard opens. Your account now stores your name, email, and a hash of the new password; use the new password for future logins.

The temporary password stops working after setup. Your email becomes eligible to receive configured chatbot service alerts; this process does not verify email ownership or provide password recovery by email.

After an administrator resets a completed account’s password, sign in with the replacement temporary password. The **Choose a new password** screen asks for **New password** and **Confirm new password** only; select **Save new password**. Your existing profile stays in place.

Setup access lasts 30 minutes. If it expires, select **Return to login** and sign in again with the temporary password, provided setup has not already completed. Refreshing the page keeps you in setup but clears unsubmitted form values. If a connection failure makes the outcome uncertain, try logging in with your new password first. Existing accounts created before this onboarding flow continue using their current credentials.

| Sidebar section or shortcut | What you can do |
| --- | --- |
| **Overview** | Read usage summaries, feedback ratings, chatbot use by website page, and question/reply trends. |
| **Conversations** | Search active/archived histories, inspect graphs and feedback, and track staff reviews. |
| **Monthly analytics** | Choose reporting months, compare usage and answer quality, inspect related conversations, and export Excel. |
| **Management → Chatbot instructions** | Edit/test generated-answer instructions. |
| **Management → Message rules** | Search, test, add, edit, reorder, or delete saved rules. |
| **Management → Response review** | Inspect blocked messages, unsure replies, and visitor feedback. |
| **Management → Change history** | Restore a saved prompt or complete rule set. |
| **Administration** (administrators only) | Create accounts, manage access, and search the dashboard audit log. |
| **Needs attention** (editors and administrators) | Open Response review with recent negative ratings, unsure replies, and blocks not confirmed as correct. |

The **Needs attention** shortcut filters the recent review lists. It does not
change review statuses or include every issue across all retained history. Use
**Show all reviews** to return to the full recent lists. Drafts remain available
when switching management areas, but are lost on reload or logout.

Select an information icon beside a heading or field for help with that item. Hovering over or focusing the icon also shows the explanation; Escape closes it. Expand sections such as **Find and replace**, **Try these instructions**, **More categories**, and **Rule details** when you need their controls.

## Know when an action takes effect

The production dashboard controls live answers. Coordinate with other editors before changing content so one person's save or restore does not overwrite another's work.

| Action | Effect |
| --- | --- |
| Search, inspect, refresh, or move graph cards | Changes your view. Dragging graph cards does not change the conversation. |
| **Preview reply / Try example message** | Tests the draft without saving it as live content. |
| Type in the prompt, **Replace**, **Replace All**, or **Add Category Guidance** | Changes the editor draft; **Save instructions** is still required. |
| **Save instructions** | Applies the saved instructions to new messages immediately. |
| **Add Rule / Save Rule** | Saves the rule for subsequent chat requests. |
| Drag a rule, **Move up**, or **Move down** | Saves the new rule order immediately; there is no separate save-order button. |
| **Delete** on a rule | Deletes the live rule after confirmation. |
| Select a status in **Flagged Conversation** | Saves the block-review decision immediately; it does not change the rule or reply. |
| Change **Review progress** or add an internal note | Saves conversation review tracking only when you select **Save review**. |
| **Remove from list** | Hides a displayed record where supported; the underlying logs remain stored. |
| **Restore this version** | Replaces the live prompt or rule set after confirmation. |

## Review a conversation

1. In **Conversations**, enter a conversation reference or words from a message or feedback comment. Optionally choose dates, question topic, visitor rating, blocked messages, website page, answer quality, or review status.
2. Press Enter or select **Search conversations**. Select **Clear search** to clear the text and filters in the current active or archived view. Use **Include archived conversations** to search active and archived histories together.
3. Select a result. Results are ordered by most recent recorded update, with 25 conversations per page. Use **Previous page** and **Next page** to move through the results.
4. Read the conversation ID, first/last recorded times, and counts. “Messages” counts user messages; responses and feedback submissions have separate counts.
5. Select a graph card to read its full text in the details panel below the graph. Use **Previous entry** and **Next entry** to step through the conversation.

Non-English messages, replies, and written feedback automatically display in English after translation finishes. A **Translated to English** marker identifies translated text and its detected source language. Select **Show original** in the selected message details to view its saved text, or check **Show original messages** above the graph to view the whole conversation in its original languages. Select **Show English translation** or clear the checkbox to return to English. If translation is unavailable, original text stays visible and **Retry translation** tries again. Search still matches the original saved text.

Graph cards distinguish **Visitor message**, **Chatbot reply**, and **Feedback submitted**. **Blocked** identifies a blocked response; **Saved reply** identifies a curated response. A turn groups a visitor message with its response.

Use the graph's zoom controls, overview map, and **Open full-screen view** to explore longer conversations. Drag cards to make the layout easier to read, or select **Reset card positions** to restore their original arrangement. **Close full-screen view** or Escape returns from the expanded view. For response feedback, **View rated reply** jumps to the answer being rated. The legend distinguishes event order from links to rated responses.

Conversation search dates use Coordinated Universal Time (UTC) and include saved messages or feedback on those days. **Answer quality** offers **Questions needing help**, **Negative reply ratings**, and **Negative chat ratings**; these use the monthly-analytics counting rules and exclude test chats.

Select **Refresh conversations** to fetch updated results and the selected history. Times use your browser's local display settings. **Time unavailable** means no timestamp was retained; **recorded with response** means the user message was reconstructed from a response record.

Select **Archive conversation** in the graph toolbar, or right-click the graph and choose **Archive conversation**, to remove the selected conversation from Conversation History and its search results. This also works in the expanded graph. The archive persists across dashboard sessions for all staff. Conversation logs are retained, and other dashboard summaries are unchanged. Use **View archived conversations** to browse the archive and **Restore conversation** to return a conversation to the active list.

History is reconstructed from retained logs. Removed or archived logs, hidden entries, and incomplete logging can leave gaps. The graph displays recorded events and their relationships; it does not expose the model's internal reasoning. Treat conversation text as private operational information even when sensitive values have been redacted.

The **Advising referral link** section shows whether a referral click was recorded. Expand **View recorded clicks** for times, destinations, and the associated reply when available. A recorded click does not confirm that the visitor completed an advising registration.

### Group conversations by visit

In **Conversations**, select **Group conversations by visit** to see expandable visit groups. Each group shows its matching conversation count, visitor-message count, and first/last recorded activity. Expand a group and select a conversation to use the same graph, review tracking, translation, and archive controls. Conversations within a group are ordered from first to last; groups are ordered by latest activity. Pagination shows 25 complete groups at a time.

Search and filters apply to individual conversations before grouping. Only matching conversations appear inside each group. **Include archived conversations** includes archived members; the archived view groups only archived conversations. Switching grouping asks before discarding an unsaved review.

New chats retain a separate visit identifier across **Reset Chat**, idle expiry, and refreshes in the same browser tab. Conversation/session IDs still change as before, keeping chat context separate. A recorded visit is browser activity, not a unique person. Older logs use recorded session links where available; missing or conflicting visit details appear as separate **Visit details unavailable** groups. Historical resets that changed session IDs cannot be linked retrospectively without recorded visit information.

### Track review progress

Select a conversation, then use **Review tracking** above its graph. Choose **To review**, **In progress**, or **Resolved**, optionally add an internal note (up to 4,000 characters), and select **Save review**. Notes and status changes appear in **Review history** with the staff member and time. Notes are only available to dashboard staff and are not sent to visitors or used as chatbot context.

Use the search **Review status** filter to find a specific stage or **Unfinished reviews**. Conversations without saved updates start as **To review**. Resolving a review does not archive it; archiving and restoring preserve review history. If another staff member saved a change first, their update appears and your draft note stays available. Check the update, choose the appropriate status, and save again.

## Review suspicious messages

1. Open **Management → Response review** and select **Refresh** in **Blocked messages**.
2. Read the card's category, user message, blocked reply, conversation ID, and turn.
3. Select **Review conversation** to open **Flagged Conversation**. Read the surrounding messages before deciding whether the block was appropriate.
4. Select the review status that best describes the issue and wait for **Review status saved.**
5. Record any follow-up work in your team's normal tracking system, including the conversation ID, turn, category, and required change. Select **Close** or press Escape when finished.

| Review status | When to use it |
| --- | --- |
| **Blocked correctly** | The message should have been blocked and the response was appropriate. |
| **Blocked by mistake** | A legitimate question was incorrectly blocked. |
| **Needs new rule** | The conversation reveals a case that needs a distinct rule. |
| **Reply needs updating** | The matching rule's reply needs correction or clearer wording. |

For example, if a legitimate question about starting a business is blocked, inspect the full exchange and mark **Blocked by mistake**. That records the finding; correcting the matching rule is a separate task. Review labels do not automatically retrain the chatbot, edit a rule, create a ticket, or remove a visitor ban.

## Read feedback and unsure responses

In **Overview → At a glance**, **Feedback Ratings** shows **Thumbs up**, **Thumbs down**, **Happy faces**, **Neutral faces**, and **Sad faces**. Thumbs rate an individual response; faces rate the overall conversation. For comments and the associated answer or conversation, open **Management → Response review** and select **Show feedback details**. **Hide feedback details** collapses the list without removing records.

For an unsure response, read the user's question, the answer, the category, and **Why unsure** when available. Uncertainty can be appropriate when the visitor has omitted important details or the answer requires current information. A low-confidence label alone does not establish that the answer is wrong.

To draft additional guidance from an unsure-response card:

1. In **Management → Response review**, select **Add guidance for this situation** on an unsure-response card.
2. Choose the relevant category under **Category guidance to add**.
3. Select **Add Category Guidance**. This adds prepared wording to the **Chatbot instructions** editor if the category marker is not already present.
4. Read the inserted wording alongside the existing instructions, test the draft, and select **Save instructions** only when ready to apply it.

This action adds general instructions to the prompt. It does not relabel the historical response or repair missing source material. For stale or missing OKSBDC information, send the source and an example question to the content owner so the knowledge store can be refreshed.

### Understand the counts

Overview and response-review summaries read retained logs without a date-range selector and can include test traffic. Monthly analytics has its own month range and excludes test conversations; Conversations has separate date/search filters. Do not describe the unfiltered summary counts as “today” or “this month.” Feedback and unsure-response detail lists are capped at 100 entries each, so the visible cards may not represent every counted record.

**Question and reply trends** summarizes recorded labels, which can be imperfect. Use it to identify topics for review; inspect actual conversations before changing content.

**Chatbot use by website page** counts recorded chatbot conversations and message turns associated with a page. It does not measure all page visitors. A conversation appearing on multiple pages can contribute to more than one page's conversation count, so adding page counts does not give a unique visitor total.

### Use “Remove from list” carefully

**Remove from list** appears on suspicious-message, unsure-response, feedback-detail, and flagged-conversation message cards. It removes the card from the current view and attempts to save a hide marker. Refresh the relevant section to check that the removal persisted; a failed request can let the card reappear.

Hiding can change displayed counts and visibility in related views. For example, hiding a message in the flagged-conversation inspector also excludes it from Conversation History and its text search. Hiding is not a universal filter across all dashboard summaries and does not delete the underlying logs. There is no staff-facing undo/unhide control. Use your organization's data-handling process for requests to delete stored information.

## Edit and test chatbot instructions

The system prompt provides instructions for generated answers. Curated rule replies and other chat processing can also affect what a visitor receives.

1. Coordinate with other editors and start from the current saved prompt. Keep a short record of the issue and the outcome you want.
2. Open **Management → Chatbot instructions** and edit **Chatbot instructions**. The limit is 10,000 characters, shown above the editor. Keep the prompt nonempty and within the limit.
3. Expand **Find and replace**. Use **Find**, **Previous**, **Next**, and **Match capital and lowercase letters** to locate wording. **Replace** changes one match; **Replace All** changes every match in the draft. Review replacements before saving.
4. Expand **Try these instructions**, enter a realistic question in **Example visitor message** (up to 400 characters), then select **Preview reply**.
5. Review the preview for accuracy, tone, useful next steps, and appropriate links. Repeat with a rephrased question and a related question that should retain its existing behavior.
6. Select **Save instructions**. Wait for the success message, then open **Management → Change history** and record the pre-change **Version reference**, along with your change rationale and the displayed dashboard version.
7. Test representative questions through the visitor chat in the appropriate environment to verify the complete behavior.

The prompt sandbox calls the model with the draft instructions. It does not run the full visitor-chat process, including classification, message-filter rules, and knowledge retrieval. If the result says that no AI preview was generated, treat it as draft validation only and contact the operator if an AI preview was expected.

A changed prompt save creates a snapshot of the previous prompt and advances the version's letter suffix. Saving identical text, ignoring surrounding whitespace, does neither. Previous replies are not rewritten. If saved instructions later revert after a server restart, report this to the operator; deployment configuration can override dashboard-managed instructions.

Example draft check: after adding guidance to ask for missing business details, try “I want to start a business. Where do I begin?” and a more specific question. Confirm that the answers ask only useful follow-up questions and still provide a helpful next step. Keep real visitor secrets and personal details out of test messages.

## Add or change a message rule

A rule matches wording in a visitor message and can send a saved reply or block the message with a reply. Test intended matches and nearby messages that should not match.

### Add a rule

1. Open **Management → Message rules**. Under **1. Choose what matches**, enter a unique **Rule name** and specific **Words and phrases**, separated by commas. Any phrase can match anywhere in a message, including inside a longer word; capital letters do not matter. **Advanced matching (regex)** accepts a pattern without surrounding slashes.
2. Under **2. Choose the visitor’s reply**, select **What should happen?** and write the exact **Reply** visitors should receive. For **Send this reply**, choose **Reply language** (English, Spanish, or French) and write the matching words and reply in that language. Optional **Question categories** help select between matching replies. Expand **More categories** for **Previous question categories** and **Visitor goals**. Existing category selections stay available when editing.
3. Read **3. Review before saving**. It summarizes the matching text, response choice, and visitor reply, and explains anything needed before saving.
4. Open **Test this rule**, enter an **Example visitor message**, and select **Try example message**. Repeat with a rephrasing and a message that should not match. The check tests only this draft’s matching text, ignoring capital letters; it does not save changes or check exclusions, categories, other rules, or full visitor-chat behavior. Changing the draft or example clears the previous result.
5. Select **Add Rule** and wait for success. The rule then applies to new chat requests. Use **Change history** to restore an earlier version if needed.

The visitor’s language selection in the chat widget determines which saved replies are eligible. The chatbot first checks matching rules in that language. If none match, it checks English rules using an English translation of the question and uses a matching English reply as guidance for an AI-generated answer in the selected language. If no English rule matches, it generates an answer normally in the selected language. Existing rules without a language are English. Blocks still apply before saved replies; the draft rule test checks text matching only and does not test translation or language routing.

### Edit an existing rule

1. Under **Existing rules**, use **Search existing rules** to find a name, matching condition, exclusion, or reply. Search ignores case and filters the list immediately; **Clear search** restores all rules. Read **Rule details** and select **Edit**. The editor shows which rule you are changing and brings it into view.
2. Simple literal matches open as **Words and phrases**. Advanced patterns and their matching settings stay intact. You can change the reply without rewriting the matching text. **Rule name** is an editable display name. The first name chosen at creation remains the permanent internal ID, so renaming keeps conversation history, analytics, ordering, and rule matches linked. Display names can contain spaces and must be 1–120 characters. Existing rules start with their IDs as their display names.
3. **Review before saving** lists the fields with unsaved changes. Saved exclusions are shown for context and kept when you save. Fix any guidance shown before saving; invalid patterns and empty required fields cannot be saved.
4. Select **Save Rule** to make changes live. **Cancel Edit** clears the draft and keeps the saved rule. If a save fails, your draft stays in the editor so you can retry.

Developer-maintained exclusions, matching flags, topic settings, and priorities are preserved. Replacement rules require advanced configuration and cannot be changed with this reply editor.

### Reorder or delete rules

Drag a rule to another position or use **Move up / Move down**. Each move saves immediately. Wait for **Rule order saved.** before making another move. Ordering affects matching, but moving a response rule to the top does not guarantee it wins: blocks are checked first, and response rules can also be selected by topic and priority.

To delete a rule, select **Delete** and confirm its display name in the dialog. Wait for the success message and record the pre-change **Version reference** in **Management → Change history**. Deleting a rule changes live matching behavior; it does not remove historical conversations.

## Restore a prompt or rule snapshot

A snapshot records content from before a change. Use it when an edit causes unwanted behavior and you have identified the earlier state to restore.

1. Coordinate with other editors and stop further edits while restoring.
2. In **Management → Change history**, select **Refresh**.
3. In **Previous versions**, locate the snapshot using **Time**, **Settings**, **Action**, the optional **Rule**, and **Version reference**. The version reference recorded after the original change identifies the saved state before that change. The list shows the 20 most recent snapshots.
4. Select **Restore this version**, check the target and time in the confirmation, and confirm when they match the intended recovery.
5. Wait for the restore success message. Refresh **Change history** and record the new pre-restore **Version reference** so the state you just replaced can also be recovered.
6. Check the restored prompt or rule list and test the affected visitor questions.

**A message-filter snapshot restores the entire rule set**, including its order. The displayed rule name identifies the change that created the snapshot; restoration can also undo later changes to other rules. A prompt snapshot restores the whole prompt. Restoration does not restore application code, the knowledge store, or conversation logs.

A changed prompt restore advances the current version suffix instead of returning to an older version number. If you cannot identify the right snapshot or need to recover other data, contact the production operator and use the [incident runbook](INCIDENT_RUNBOOK.md).

## Use monthly analytics and export a report

Use **Usage & referrals** for visit/chat totals, referral engagement, the month-to-month trend, and monthly usage. Use **Answer quality** for questions needing help, ratings, saved-reply suggestions, AI-written versus saved replies, and monthly feedback. Use **Topics & rules** for question categories, reply types, and rules used. The date controls and Excel export apply to all three subtabs; the export includes the full report regardless of the selected subtab.

1. Open **Monthly analytics**, choose **From** and **Through**, and select **Update report**. The last applied range is remembered for your dashboard username in this browser, including after closing the page. Without a saved range, the initial range is the current UTC month and the previous 11 months; ranges can span up to 60 months. Editing the dates alone does not update the displayed report or export.
2. Read the summary cards for **Visits**, **Chats**, **Chats per visit**, **Messages per visit**, and **Advising referral clicks**. Use the information icons for definitions and details about missing visit records.
3. Review **Answer quality and follow-up**. Use **View conversations** on a quality card to inspect related histories for the applied range. This searches distinct conversations, so result counts can differ from question/rating counts. Archived histories still contribute to analytics; select **Include archived conversations** to include them in the same search, or switch to the archived view.
4. In **Month-to-month trend**, choose a **Measure** to compare usage, referral clicks, reply types, answer quality, or rating percentages. Scroll the chart horizontally for longer ranges. **Usage by month** and **Feedback and replies by month** provide the detailed monthly figures.
5. In **Question categories and rules**, choose **Show details for → All selected months** or a single month. **Question categories**, **Types of replies**, and **Rules used** show the top five entries initially. Select **Show all (count)** to expand a list and **Show top five** to collapse it. This choice affects those breakdowns, not the report range or export.
6. Select **Export Excel (.xlsx)** after the report loads. The workbook includes Summary, Monthly usage, Question topics, Replies, Answer quality, and Counting notes for the loaded range. It contains aggregates rather than visitor messages or identifiers.

### Read answer quality and ratings

**Questions needing help** counts each visitor question once if it has no recorded reply, an unsure answer, or a backup/failed reply. Reasons can overlap, so adding their counts may exceed the total. Intentional blocks are excluded. A missing reply record alone does not establish a failed visitor experience.

**Negative reply ratings** is the percentage of rated replies receiving thumbs down. **Negative chat ratings** is the percentage of rated chats receiving a sad rating. Beside each, **Participation** shows how many of all recorded replies or chats received a rating. For example, 2 thumbs-down replies among 10 rated replies out of 100 recorded replies means 20% negative ratings and 10% participation. Feedback reflects only visitors who chose to rate; the latest rating is retained. A dash means there is no denominator.

**Changes in negative ratings** compares completed months in percentage points: 10% to 15% is 5 points higher. The current month has an asterisk and is not compared. Check participation and the number of ratings before interpreting a change.

**Question topics needing help** groups issues by recorded topic. **Topics to review for saved replies** suggests identified topics with questions needing help, negative reply ratings, or at least three AI-written replies and no saved replies during the range. These suggestions need human review; saved-reply counts measure replies actually used, not available rules.

### Read referrals and reply breakdowns

**Advising link follow-through** shows the share of chats that clicked an advising link among chats that shared one during the applied range. Both the shared link and click must fall within the range. **Referral clicks across all chats** shows the share of all active chats with a referral click. Each chat counts once in these percentages; **Advising referral clicks** counts individual clicks, including repeats. **All OKSBDC link clicks** also includes other OKSBDC destinations. A click does not confirm a completed advising registration.

**AI-written vs. saved replies** compares only those two reply types across all selected months. Saved replies include prepared safety messages. Blocked messages, backup replies, and errors are excluded from this comparison, so its total can be lower than all recorded chatbot replies. **Messages using AI** also includes questions where AI helped assess a topic or attempted an answer; one message can use both AI and a rule.

The percentages in **Question categories**, **Types of replies**, and **Rules used** use visitor messages for the selected breakdown period. One message can match several rules, so rule percentages need not add to 100%. Missing topics appear as **Topic not identified**.

### Understand the reporting period and coverage

Calendar months use UTC. **Visits** means recorded browser sessions with chat activity, not unique people or every website visitor. New widget versions keep the same recorded visit across resets; older history may count a reset as a new visit. Chats or visits can appear in multiple months; whole-period totals count each once. Averages per visit exclude activity without visit details. **Messages per visit** averages visitor messages; **Total messages** also includes chatbot replies, including block notices and backup replies.

Test conversations and administrative activity are excluded. Hidden and archived conversations still count while their source history is retained. Zero means no matching saved activity; deleted history cannot be recovered. Later feedback can update earlier months, so exports from different dates can differ. Check information icons and any missing-history notes before sharing conclusions. Coverage notes about unreadable, invalid, or undated records describe all saved history checked for the report.

## Suggested daily review

1. Refresh conversations, suspicious messages, and feedback/unsure responses.
2. Review negative feedback and inspect questionable blocks in context.
3. Record issues with conversation IDs and turns; decide whether they need a rule correction, prompt clarification, or knowledge-content update.
4. Make and test focused changes using the relevant workflow above. Record the outcome and recovery snapshot.
5. Log out when finished.

## Troubleshooting and getting help

| Problem | What to do |
| --- | --- |
| **Incorrect username or password** | Recheck the credentials, then contact the administrator for account assistance. |
| **Dashboard authentication is not configured** | Contact the operator; an account store must be configured before you can sign in. |
| Login returns or a request reports an expired session | Sign in again. Verify the saved state before repeating a change; keep a private copy of any draft still available. |
| Management or Administration is missing | Check your account role. Management requires Editor or Administrator; Administration requires Administrator. Ask an administrator if your access needs changing. |
| A list is empty or a conversation is missing | Clear search and refresh. Logs may have been archived or entries hidden. Ask the operator if expected recent records are absent. |
| A section fails to load | Refresh that section. If the error persists, record the displayed error and time for the operator. Preserve drafts before reloading the entire page. |
| A prompt or rule test fails | Check required fields and length limits. For regex errors, check the expression with a developer. AI preview failures may require the operator to check model availability. |
| A save fails or its outcome is unclear | Read the error and preserve the draft. Verify current saved content before retrying; do not assume the edit reached the live chatbot. |
| A rule matches in the sandbox but visitor chat differs | Capture the test wording, expected reply, and actual reply. Ask the developer to check the complete rule and chat flow. |
| A live edit produces incorrect answers | Identify its pre-change snapshot and follow the restore procedure. Escalate ongoing service problems through the incident process. |

When reporting a problem, include the dashboard version, time, affected section, conversation ID/turn or rule/snapshot ID, and the visible error. Share necessary redacted examples through your organization's private support channel. Never include passwords or access tokens.

For operator procedures, see the [production handbook](PRODUCTION_HANDBOOK.md). For implementation details, see the [API reference](../server/docs/api.md), [logging and dashboard data](../server/docs/logging-and-dashboard-data.md), and [message filtering reference](../server/docs/message-filter-and-safety.md).

## Administration

Open **Administration → Users & access** to manage dashboard users, or **Administration → Audit log** to inspect recorded dashboard activity. Only administrator accounts have this tab. Editors retain Management access; read-only accounts can inspect conversations and analytics.

- To create a user, enter a username and choose Read-only, Editor, or Administrator, then select **Create user**. Share the generated temporary password privately. It is displayed only in the creation result; the new user completes their profile and chooses a new password on first login.
- To change access, choose a user's role and select **Save role**. Their existing session stops working, and they must log in again.
- To reset a password, select **Reset password** and **Confirm reset**. Share the generated temporary password privately; it hides automatically after one minute or when dismissed. Existing sessions are invalidated. On the next login, the user must choose a different new password. Completed accounts keep their profile; new accounts still complete their profile setup.
- To prevent new logins, select **Lock**. The account shows **Locked**, and correct credentials cannot start new sessions. Existing sessions remain valid. Select **Unlock** to restore login access.
- To sign out all sessions, select **Revoke sessions** and **Confirm revoke**. Sessions are invalidated immediately without changing the password or lock status. Revoking your own sessions returns you to login.
- To delete an account, select **Delete**, check the username, and select **Confirm delete**. This removes login access and invalidates existing sessions, while retaining conversation and review history.

You cannot delete or lock your own account, change your own role, or reset your own password here. Another administrator can reset your password.

The **Dashboard audit log** in the **Audit log** subtab shows recorded dashboard changes and rule tests, newest first, with the time, action, operator, and target. Enter an action, username, account ID, or other target in **Search audit log**, then select **Search**. Clear the field and select **Search** again to show all entries. Select **View details** for recorded details and request metadata, **Older entries** / **Newer entries** to browse 50 entries at a time, and **Refresh audit log** to load the latest records. Successful user-management changes refresh the log automatically. Only administrators can view this log.


## Test the live chatbot

Editors and administrators can select **Test live chatbot** in the dashboard header. A test window opens the real widget using the current saved instructions, message rules, and knowledge sources. Unsaved dashboard edits are not used. Close the test window to return to your work; your dashboard drafts remain available.

Each test session lasts 30 minutes and starts with a separate conversation. Test messages, replies, feedback, and link clicks are not saved in conversation history or analytics. Minimal failure diagnostics are retained. Tests make real model requests and normal usage limits and safety rules apply. If the session expires, close the window and start another test. Read-only accounts do not have this button.

To check the waiting indicator, enter a **Response delay (seconds)** and select **Simulate delayed response**. This uses your typed message or a sample message and produces a local simulated reply without calling the AI service. The three dots pulse while waiting, and **We're working on it** appears after 12 seconds. Simulation can exceed the normal 90-second request timeout; resetting or closing the test cancels it.

Select **Enable lite mode for this test (saved responses only)** to test the chatbot with AI disabled. Send messages normally: matching saved rules answer immediately; unmatched questions receive an unavailable message. A **Lite mode** badge and notice explain the limitation. Unchecking the box restores normal test routing unless automatic traffic protection is active. This toggle affects only your test and does not trigger traffic alerts.

During unusually high public traffic, the server can activate lite mode automatically and email active administrators using configured account email addresses. The default trigger is 300 requests per minute; normal routing resumes ten minutes after the last threshold breach. A high request count indicates a possible attack or traffic surge. Existing rate limits continue to apply.
