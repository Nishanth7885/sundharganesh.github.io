document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Terminal Typing Effect
    const textElement = document.getElementById('typing-text');
    const outputElement = document.getElementById('terminal-output');
    
    // Phrases derived from resume skills [cite: 5, 7, 10, 14]
    const phrases = [
        "docker run -d -p 80:80 nginx",
        "systemctl status prometheus",
        "tail -f /var/log/syslog", 
        "git push origin main",
        "echo 'Hello, World!'"
    ];
    
    let phraseIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let typeSpeed = 100;

    function type() {
        const currentPhrase = phrases[phraseIndex];
        
        if (isDeleting) {
            textElement.textContent = currentPhrase.substring(0, charIndex - 1);
            charIndex--;
            typeSpeed = 50;
        } else {
            textElement.textContent = currentPhrase.substring(0, charIndex + 1);
            charIndex++;
            typeSpeed = 100;
        }

        if (!isDeleting && charIndex === currentPhrase.length) {
            // Finished typing phrase, mimic command execution
            isDeleting = true;
            typeSpeed = 2000; // Pause before deleting
            
            // Optional: Add "output" to the terminal body below
            addTerminalOutput(currentPhrase);
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            phraseIndex = (phraseIndex + 1) % phrases.length;
            typeSpeed = 500;
        }

        setTimeout(type, typeSpeed);
    }

    function addTerminalOutput(command) {
        let output = "";
        // Fake outputs based on the command
        if(command.includes("docker")) output = "fc486638b930... (container started)";
        if(command.includes("systemctl")) output = "● prometheus.service - Prometheus\n   Loaded: loaded (/etc/systemd/system/prometheus.service; enabled)";
        if(command.includes("tail")) output = "Dec 28 10:00:01 ubuntu CRON[1234]: (root) CMD (command)";
        if(command.includes("git")) output = "Enumerating objects: 5, done.\nWriting objects: 100% (3/3), 256 bytes, done.";
        
        if(output) {
            const line = document.createElement('div');
            line.style.color = "#8892b0";
            line.style.marginBottom = "5px";
            line.style.fontSize = "12px";
            line.innerText = `> ${output}`;
            outputElement.appendChild(line);
            
            // Keep only last 3 lines to prevent overflow
            if(outputElement.children.length > 3) {
                outputElement.removeChild(outputElement.firstChild);
            }
        }
    }

    // Start the typing effect
    type();

    // 2. Smooth Scrolling for Navigation
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });

    // 3. Scroll Animation (Fade in elements)
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('show');
            }
        });
    });

    const hiddenElements = document.querySelectorAll('.section');
    hiddenElements.forEach((el) => observer.observe(el));
});