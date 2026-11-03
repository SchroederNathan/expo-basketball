# Scores title repeats the selected date

Original acceptance criteria for a Lob bug that the app owner reported.
Keep this file and the fixture bytes unchanged when implementing the fix.

The Scores screen shows the selected date as its navigation title, such as Oct 26.
The date strip under the header already shows that date, so the title repeats it.

1. Open NBA Scores. The date strip marks Monday, October 26 as the selected date.
2. The navigation title reads Scores. The header shows no date or weekday text, such as Oct 26 or Mon.
3. Select Sunday, October 25 in the date strip. The navigation title still reads Scores, and the strip marks October 25.
4. Tap Today. The strip marks October 26 again, and Orbits 100, Comets 108, and Final are visible.
