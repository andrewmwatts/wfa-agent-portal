// Built-in sales scripts, shown in the Leads script pane beside the client card.
// Bodies use the same light markup as personal scripts (see ScriptPane.jsx):
//   # Heading   ## Subheading   ### Label   1. numbered   - bullet   > tip box
//   [stage direction] renders italic; a blank line starts a new paragraph.
// The PDFs in /public/sales-scripts are the printable versions of the same text
// (linked from the Scripts tab in LeadsPage.jsx).

export const DEFAULT_SCRIPTS = [
  {
    id: 'default-best',
    tab: 'B.E.S.T',
    heading: 'B.E.S.T System Script',
    subtitle: 'The B.E.S.T for every lead',
    icon: '📞',
    body: `The B.E.S.T. Script is your multi-use tool for every lead type. Only slight adjustments are needed to effectively adapt this script to any lead (Mortgage Protection, General Life, etc.).

# Be Busy
Pick up the phone! This is a simple numbers game. The more dials you make, the more appointments you set and the more families you help. Most successful full-time agents make 500+ dials per week, or they dial until they have 20+ appointments to submit $5,000+ APV weekly.

# Establish the Reason You're Calling
Remember, you're calling because the client sent in a request asking for your help! Now it's your turn to help your client obtain the coverage they deserve.

"Hey, (client's first name)." [Wait for response.]

"Hey, this is (your name). I'm calling about your mortgage over at (address). Looks like it's for (loan amount)." [Pause and wait.]

"I was getting back to you about the form that you responded to regarding the mortgage protection coverage that would help pay the mortgage for your family if something were to happen. I just needed to quickly verify the information you provided so we can get those options worked up for you. You had put down that you're (age). Is that correct? And when do you turn (next age)? When's your birthday? And I have your spouse's age and date of birth as __________?"

[Start filling out the client qualification form.]

"I have a couple of quick questions so I can make sure I'm looking at the right companies for you.

1. How's your health? Any medical issues?
2. Have you used any nicotine or tobacco in the last 12 months? You don't plan on starting this weekend, do you? [Get a laugh and put them at ease.]
3. What medications does your doctor have you on?
4. Any hospital stays, ambulance rides or major surgeries for you in the past 10 years or so?
5. And how about (client's spouse's name)? Anything for them?
6. Is there any history of things like high blood pressure, diabetes, cancer or heart attack for either of you?
7. And then, just ballpark, what's your height and weight? And your spouse?
8. What do you do for work? Anything dangerous, like a stunt man/rodeo clown? [Get a laugh.]
9. And then what does your work schedule typically look like? 9-5 Monday through Friday? What about your spouse?
10. [Mortgage Protection] It says the amount of the mortgage to be paid off is $________. Is that correct?
11. And did you guys go with a 15 or a 30-year loan?
12. And what's the monthly payment on that?
13. Alright, perfect. And most importantly, when you responded to the form, what was the main concern for you? What specifically were you wanting the coverage to do for you?
14. Were you looking for coverage on just yourself, or for both you and your spouse?"

# Set Appointment
"Okay, that makes a lot of sense. I have enough information to start shopping your case across all the carriers. I'll need some time to do that, and then we'll just need to schedule a quick call to go over the options together and see what might make sense for you and answer any questions you might have. Let me just pull up my calendar."

"We've had a ton of these requests come in so my schedule is pretty crazy right now." [Begin funnel approach: two days, two timeframes, two times.]

[Two days.] "I have a couple of openings either today or tomorrow. Which of those would work best?" [Book within 48 hours.]

[Two timeframes.] "Okay. For tomorrow, would earlier or later in the day work better?" [Afternoon or evening? Before 5 pm or after 5 pm? Etc.]

[Two times.] "Okay. I have an opening at 5:15 pm or I can squeeze you in at 6:45 pm. Which of those would be better for both you and (client's spouse's name)?"

# Tie Down
"Okay, and you're positive that time works for both you and (client's spouse's name) together, correct?" [No one-legged appointments. Find a time when both are available.]

"Okay grab a pen and paper and let me know when you're ready. I'm going to give you my information and a few things to have ready for our appointment."

"Go ahead and write down my name. It's (your name). Then write down 'Mortgage Protection.' And what time did we say again? Perfect. Go ahead and write that down as well. And just a couple things to have ready before our call. Make sure you have your doctor's info and have any medications that you're on, just have those available."

"And what's a good email for me to send the appointment confirmation to?"

"Okay, I have us down for (day) at (time). Sometimes the families that I am working with need a little extra time, so give me about a 15-minute window, just in case, and I'll make sure I give you the time you need as well. If I am running more than 15 minutes behind, I'll make sure I let you know."

"Have a great day and we'll talk to you on (day) at (time)."

# Power Phrases for the Phone
- "That's exactly why I am calling."
- "Here's what we're going to do."
- "Let's do this..."
- "I can try to squeeze you in at (time)."
- "Grab a pen and let me know when you are ready." vs. "Can you grab a pen?"
- "Can you just email/call me back later?" → "That's a great idea! I'll be super brief. Let me verify your information quickly, then I will get your options out to you."

> TIP: We NEVER email options. The goal of the initial call is to book an appointment, then share their options during the live appointment.`,
  },
  {
    id: 'default-real',
    tab: 'R.E.A.L.',
    heading: 'R.E.A.L. Sales Presentation',
    subtitle: 'Rapport · Emotion · Assumption · Lock It Down',
    icon: '📋',
    body: `# Section 1: Rapport
The agent should build rapport for a few minutes. Try to connect with the client and find commonality. Don't overdo this. Avoid being a "professional visitor." If you are in the home, direct the client to their kitchen table. Your tone should be friendly but in control.

## Possible Topics
- Compliment them on connecting to Zoom if appropriate.
- New home or refinance? How long in the area? Moved from elsewhere?
- Occupation — how did you get started in that?
- Family — any family nearby?

## Transition to Presentation
"So, let me start off by showing you a few things about me. [share screen if virtual]

Here's my insurance license... driver's license and business card... picture of my family... [this confirms your identity and purpose]

Let me show you, this is what you folks mailed in... [show the lead]

Which one of you responded? And I know we talked about this briefly on the phone with you ____ (person you spoke to on phone) — but now that we are all together — what was your main concern? [this is their "surface why"]

[Repeat back in your own words] So, what I am hearing is ________. Is that right? Well that makes sense for sure. And how long have you guys been thinking about this kind of protection?"

## What is Mortgage Protection?
"OK, (name of client), real quick let me explain what mortgage protection is:

You probably already know, but it is a life insurance policy for homeowners that will pay off the mortgage or make mortgage payments while the family is in transition after someone dies. Mortgage protection can also be used to replace income if the breadwinner has a critical illness or disability in their working years.

Now, this is not the old kind of mortgage protection. Meaning that your lender will not be your beneficiary. So, who would your beneficiary be (name)? [Write this down]

So, (beneficiary) will receive the benefit. One of the other major differences is that this is not a decreasing term. In other words, if something happens to you tomorrow or 10 years from now, your death benefit will remain the same. This policy is also portable, so if you refinance or move, you can take this mortgage protection with you.

Now, some people do a full mortgage payoff if that's in the cards. Some do half. A lot of people just do a little bit, just a little bit to help their family with the transition to the next step, okay? It really depends on two things. First, it depends on budget; everyone's got a budget. And second, it depends on what you qualify for in terms of age and health, make sense? [Wait for response — they need to be engaged — keep them accountable to your questions early and that will carry throughout your presentation]

Now, it's important to know most people already have life insurance. It's really common. Some have it through work, some have their own policy, some have 401K money, maybe a rich uncle. I'm still waiting on mine [laugh]. Some have money in the bank. In other words, we all work to build up a nest egg, right?

That's why people get mortgage protection separately. They don't want their family to have to use the nest egg money to pay for the mortgage, they want that nest egg to go to the family, and they want the insurance company to pay off the mortgage debt. It's another way people use life insurance nowadays. Does that make sense?"

## Explain Your Role and Purpose
"My role in all of this is what they call a 'field underwriter.' Each week I work with 12-15 families in your area who have all requested this type of insurance. I have access to all the top-rated companies that offer this coverage, so I am able to shop around for you. My job is to find you the best coverage you qualify for at the best price. [This eliminates the "I need to shop around" concern]

So, there are a few things we'll do today:

I'm going to verify your health information. Some carriers are super picky about prescription and medical concerns, others are not. So, I need to know the details so I can match you with the best company. I don't work for any one company — I work for you. So, please be honest with me so I can help get your family protected. The good news is that you don't have to see a nurse, give blood or urine, etc. with these programs. [This eases their mind about health issues and builds trust]

Then I have some detailed questions about your mortgage and your finances. Some of these might even be uncomfortable for me to ask, but I am not doing this to be nosey. I am doing this to make sure, in my professional opinion, that you have a need for this coverage. Not everyone has a need, and if that's the case with you, I will let you know honestly and be on my way. We find that most people need way less than they think they need, and if that's the case I can save you some money and be the hero. [laugh] [This helps to set up critical period concept or partial pay-offs and builds trust that you won't try to oversell them. It also sets up expectation for why we ask personal financial questions]

Once we narrow this down to a few programs that I think you will qualify for, your job is to pick out the program that best suits your needs and your budget. [Lets them know they have an active role or "job" in this process and are in control]

As we're talking, I'll be filling out some "paperwork" on my screen, [if virtual] and this is what we'll be submitting to the insurance company tonight to get their final approval: which could take two to seven days. [Lets them know business is taking place today]

Once they approve the application your family will be protected. But it usually takes about 10-14 days to get the policy mailed to you. At which time we'll get back on the phone or computer, we'll go over everything together in detail and make any changes if needed. Sound good?" [This gets your first "yes" from your client]

# Section 2: Emotion — Explore Their Situation
Health is the easiest place to start because we already began to review that on the phone and it's less emotional of a topic. Next we dig into finances, which will do the heavy lifting for creating the emotion of why they need this. Numbers don't lie.

## Verify Health
"First, we need to verify the medical side to confirm which carriers you would qualify with. [Review the CQF form from your phone call]

I am going to share my screen [if virtual] and run through a list of about 15 health questions. Some of these are going to sound crazy but I have to ask them anyway. [laugh] And if any are "yes" don't worry — I just need your full honesty like I mentioned earlier. So just really quickly, what medications are you prescribed...."

[Review full medical information]

## Financial Information Form (FIF) and Cashflow Analysis
This very important part of the process is used to set up future Preferred Client Services (PCS) needs. The FIF is required for every client.

"Okay so now I want you guys to grab a pen and paper and let me know when you are ready. [If virtual — at this point you can share a whiteboard screen on Zoom or simply grab your FIF form and write with the client. If in-person you will fill out the FIF with the clients observing you. We want client engagement in this process, so have them actively participate]

So that we can get a better picture of what cash flow would look like, we are going to do a quick financial review."

## Get the Equity Number
[Start your fact finding by discovering the amount of equity they have in the home. This is a critical step for any Equity Protection plan during the critical period.] "So, your mortgage is about $XXX,000, right? Let's write that at the top of the page. And let me ask you, if you had the time to prep the home and put it on the market tomorrow and didn't have to take a low offer, you were patient and got the full value, what would it sell for? Okay write that number next to what you owe. Okay, if we subtract what is owed from what it would sell for, we get $_________ in equity. Is that what you see as well?"

[People should be proud of their equity — congratulate them] "And that's today. 10 years from now, it's thousands more, 15 or 20 years from now it can be hundreds of thousands more. As time goes by, what you owe goes down and what it's worth goes up. This equity often is the biggest part of the legacy left for a family. Does that make sense? Let's write the equity just below those numbers.

For most families, the number one job for mortgage protection is to make sure that equity stays with the family and never walks out your front door, right? That's your family's money, part of your nest egg, it should never go to the bank or to a low-ball investor buying your home as a distressed sale, right? So, at a minimum we need to protect that equity. Do you see that?

Now let's do a quick review of major household expenses.

[List out mortgage payment, all major debts, and all major monthly expenses to achieve a "quick budget." This helps to avoid the "need to check our budget" and also shows where cash flow will be a problem. Don't get mired down in a lot of detail here. We just need approximate numbers. We don't want to frustrate the client with too many details.]

When we add this up it looks like about $_____ comes out for the bills every month. Does that seem about right?"

## Uncover the Cash Flow Problem
Cash flow is the problem we are trying to solve. Helping the client understand the cash flow problem when someone passes will create the emotion.

"Now, let's make two columns on the page. One for you (spouse) and one for you (other spouse).

(First spouse) if you didn't come home last night, what is already in place that would pass on to (other spouse) to help (him/her) keep this house and this lifestyle, such as other life insurance, savings, retirement accounts? [Go through these one by one and ask questions for each based on the FIF form]

And (other spouse) same questions for you: what is already in place today that would pass on to (first spouse) to help (him/her) keep the house and the lifestyle?

Okay, let's talk about income. (First spouse) what do you bring in on a monthly basis? And (other spouse)?

Any pensions for either of you? Military benefits for either of you? Any other income? So, it looks like aprox $_________ is coming into the house every month, correct? [Write down this total]

Now, if something happened to you first (name), how much money would stop coming into the house from your side every month? Would any income transfer over? Okay. And what about you (spouse name) how much money would stop coming in if something happened to you?"

[You may need to help clients understand what happens to Social Security benefits when a spouse passes. Ask if they understand the SS process? If married, the surviving spouse is able to keep the higher of the two SS incomes but the other SS income goes away]

## Cash Flow Analysis
We now take time to do the math with the client. $__________ is the combined income coming into the house every month and $_______ is the total approximate amount of household expenses.

"Without (Bob's income) it looks like you would be left, (Mary), with $________. And without (Mary's income), it looks like you would be left, (Bob), with $_______. Is that what you guys see? [At this point the cash flow problem and need should be obvious. Take your time here and let this sink in.]

Okay, I can better understand now why you responded to the letter."

## Quality Questions
[Select a few of these questions to ask based on the situation, the program and your personal preference]

- How long would you want to stay in this house by yourself?
- How long could you stay in this house?
- Where would you want to go?
- Who would have to move in with you?
- Knowing this cash flow analysis, what specific challenges would you have?
- What would you have to do to maintain the mortgage and your lifestyle?
- What does that look like?
- How do you feel about that (other spouse)?
- What are your thoughts (other spouse)?
- How long do houses take to sell around here?

### If single
- What would the kids do with this house?
- Which of your kids would be making this mortgage payment?
- Do they have a mortgage as well that they would need to also pay?
- How hard would it be for your kids to make their own mortgage/rent and this one?
- How long do houses take to sell around here?
- Would all of the kids move in here together or would one child most likely need to?
- Would one child buy-out the others?

# Section 3: Assumption
We can assume that our clients want the coverage. Remember that price is only important in the absence of value. We don't sell on "features and benefits," we use those to lock down the sale after it is made. We sell based on needs.

[At this point in the presentation you have a good idea which road you are taking them down: Full/Partial or Critical Period]

## The "Think About It"
"Based on what you just shared with me, let's look at some programs. I am going to include at least one that is our most comprehensive, but I am going to count on you to be honest about your budget. Sometimes homeowners will beat around the bush and say things like 'I need to think about it, sleep on it, etc.' I've been doing this long enough to know what that means. It means the price isn't right. So, if what I'm showing you doesn't fit the budget, can I count on you to be honest with me? These are just some of the programs and we will definitely find you something tonight that fits comfortably inside of your budget as a good starting place, OK?"

## Explain Programs
There are three ways to do Mortgage Protection:

### 1. Full Payoff
[Explain full payoff, Living Benefits and ROP to those clients who are age 65 or less. Note that some benefits such as ROP and disability riders have age restrictions]

[If you select Critical Period, no need to go into a lot of detail here. We don't want the client getting excited about something they most likely cannot get or afford]

"Full coverage is generally the most expensive and hardest to qualify for. And 95% of the time I can find something more affordable for my clients over 65 years old."

### 2. Partial Payoff
"As we discussed earlier, this is great for families that have two people bringing in the income. Especially during their working years. Let's say one person cannot work or dies, it is always helpful to have half the mortgage paid down or a big chunk paid down so it is affordable for the remaining person. For example, (spouse) if ______ dies and I brought you a check for $50,000 even though your mortgage is $100,000 would you be mad at me? What could you do with that $50,000?" [Stop here and get clients to engage with you. Have them tell you what they could do with a lump sum of money. Ex. pay down the loan, refinance for lower payment, down payment on a smaller place, etc]

[If going critical period] "With your age and health, honestly (client name) this one can also be hard to qualify for. For really anyone over 65, but is a little cheaper than full pay-off."

### 3. Critical Period / Equity Protection
[If under age 65 and healthy, don't present this option]

"Most of my clients that are around your age with similar health go for option three. It is the most affordable and the easiest to qualify for.

It's called Critical Period Coverage or Mortgage Payment Protection because it covers the most critical period of time after the loss of a spouse or loved one when the family is at most risk of losing the home. Let me explain.

[Start with talking to the person who would be in the most trouble if something happened to the breadwinner] If something were to happen to (breadwinner's name) tomorrow, does the bank come to (beneficiary name) and ask for the full $150,000 you owe?

No, they just want what?

[Stop, engage client and get client to say the bank just wants the payment] People go into foreclosure not because the bank wants the payoff but because the bank wants the payment. It would be nice if the bank would call you up and say "We're so sorry for your loss and we're going to waive your payments for the next six months to a year," but they don't do that, do they? No, they probably won't even know if someone has died. They just want the payment.

What this program option is going to do for you is buy you some time. Time to grieve properly, time to make a plan and time to put the house on the market long enough to get the top dollar for it without your family having to come out of pocket to make that mortgage payment each month. In my opinion, I would not spend a bunch of money trying to pay off a house that you don't plan on staying in anyway. Instead, the policy would cover mortgage payments long enough to sell it and get out the equity. That equity can become the benefit for (beneficiary) or the legacy for your family. Many times, the equity in the home can be the biggest asset a family has! Does that make sense?

Of these three ways I just described, which one should we begin pricing?"

## Show Options
[If option one or two — have options prepared that are anchored by the 10% rule. Have an option above 10%, at 10%, and below 10% of the monthly mortgage payment]

[If critical period option — start with the number of months they give you in this question]

"Knowing that most people will need at least a few months to grieve — how long do you think it would take you or your kids after that to make a plan, pack up, get the house ready to sell and allow time on the market for it to receive the highest offer?" [Ex. they say it would take at least a year, show 12 months of mortgage payments, nine months and 15 months]

[Just before you show the numbers, go ahead and start answering the most common questions we know will be asked about the coverage before they arise. "Just so that you know some more details of this program... this is a ______ (term/whole) life program... Premiums won't increase... Death benefit won't decrease... the money will be delivered in a lump sum to your beneficiary, etc." This is the time where you can showcase free riders, level premiums, cash value accumulation or any features and benefits that will enhance the program.]

## The Close
"Okay, now which one of these fits most comfortably inside your budget? [Be quiet here and give them time to answer]

Okay, from here I am going to share my screen [begin sharing your screen if virtual] and finish filling out your paperwork. Go ahead and grab your driver's license for me. While you are doing that, what is the full name of your beneficiary?"

# Section 4: Lock It Down
[If you do not make the sale, skip to the "Client Survey" section of this script.]

## Secure the Sale
"One thing I take pride in is making the right recommendations to my clients and making sure that you're satisfied with your program. I'd like you to tell me in your own words — what did we just do here today?

[This will ensure policy persistence. Have the clients repeat back to you and use prompts if needed. How much coverage did we put in place (or how many months of mortgage payments)? What is that coverage for? How much will it cost monthly? Approximately how soon do we expect the first payment to draft? Why did we choose this program?]

What questions do you have for me before I leave?

The program we chose today — do you have peace of mind that this will help your family?

Over the next ____ days/weeks I'm going to work with the insurance company to get your policy approved. I will be checking in with you every few days to let you know how things are going. When the policy is approved, I will come back out and we will review it together, or we can arrange a phone call to review. We will also be doing an annual policy review with someone from our Member Services department.

Also let's take a minute to save my number in your phone. [Having clients save the number ensures that they recognize the number when you call]

Contact me anytime for anything. I'm your agent now. If anyone else calls you about life insurance feel free to give them my number and have them call me. Our company may send you a few more letters in the mail — you can ignore those now that we have a program in place for you."

## Client Survey / The 5 R's
[If the client has assets and/or if they are still working — complete this step regardless of whether or not you make the sale.] "Lastly before I leave, given some of the information you gave me earlier — I just have a brief client survey to complete with you. Our Client Services department can help clients with several aspects of their overall financial plan and I want to make sure we aren't missing anything before I leave."

[Refer to the Client Survey sheet and begin completing. Book a followup appointment based on answers from the survey.]`,
  },
]
