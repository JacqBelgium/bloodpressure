Ik wil een Next.js applicatie opzetten in deze repo voor een wekelijkse
isometrische-oefeningen-app tegen hoge bloeddruk. Werk in het Engels voor
code/comments, maar de content in de database is tweetalig (NL/EN).

Zet het volgende op:

1. Initialiseer een nieuw Next.js project (App Router, TypeScript, Tailwind CSS)
   in de root van deze repo.

2. Installeer en configureer de Supabase client (@supabase/supabase-js en
   @supabase/ssr) voor gebruik met Next.js App Router (server + client components).

3. Maak een .env.local bestand (en zorg dat die in .gitignore staat) met
   placeholders voor:
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   Ik vul deze zelf in met mijn eigen Supabase-gegevens.

4. Bouw een registratiepagina (/register) met:
   - Velden: voornaam, email
   - Taalvoorkeur: NL/EN keuzeknoppen, vooraf ingevuld op basis van de
     browsertaal (navigator.language), maar door de gebruiker aan te passen
   - Supabase magic link login (geen wachtwoord)
   - Bij succesvolle registratie: gebruiker wegschrijven naar de 'users'
     tabel (kolommen: email, voornaam, taal_voorkeur) en direct doorsturen
     naar de hoofdpagina

5. Bouw de hoofdpagina (/) die:
   - De huidige-week-oefening ophaalt via de bestaande database functie
     get_current_exercise() (roep deze aan via Supabase RPC)
   - De oefening toont in de taal van de ingelogde gebruiker (taal_voorkeur)
   - Een disclaimer bovenaan toont: "Deze oefeningen zijn een aanvulling op
     — niet een vervanging van — voorgeschreven medicatie. Volg altijd de
     adviezen van je behandelende arts of specialist." (NL) / Engelse
     vertaling indien taal_voorkeur = en
   - De week-positie toont (bijvoorbeeld "Week 3 van 20")
   - Ruimte laat voor foto/video/audio (gebruik de foto_url/video_url/
     audio_url_nl/audio_url_en velden uit de database, met een nette
     placeholder als die leeg zijn)
   - Bronvermelding toont: "Source: Personal Coach Gent"

6. Zorg voor een basis, rustige visuele stijl passend bij een
   gezondheids-app: kalm, vertrouwenwekkend, toegankelijk (grote leesbare
   tekst, want doelgroep is soms ouder).

Werk stap voor stap, leg elke stap kort uit in gewone taal (ik ben geen
developer), en vraag om bevestiging voordat je naar de volgende grote stap
gaat. Begin met stap 1.