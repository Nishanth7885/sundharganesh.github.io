document.addEventListener('DOMContentLoaded', () => {
    
    // Typing Effect for Terminal
    const textElement = document.getElementById('typing-text');
    const outputElement = document.getElementById('terminal-output');
    
    const phrases = [
        "docker ps -a",
        "systemctl status prometheus",
        "git push origin main",
        "./deploy_stack.sh"
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
            isDeleting = true;
            typeSpeed = 2000;
            // Add fake output line when command finishes
            if(outputElement) addTerminalOutput(currentPhrase);
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            phraseIndex = (phraseIndex + 1) % phrases.length;
            typeSpeed = 500;
        }

        setTimeout(type, typeSpeed);
    }

    function addTerminalOutput(command) {
        let output = "";
        if(command.includes("docker")) output = "CONTAINER ID   IMAGE     STATUS";
        if(command.includes("systemctl")) output = "● Active: active (running)";
        if(command.includes("git")) output = "Enumerating objects: 15, done.";
        if(command.includes("deploy")) output = "Stack deployed successfully!";
        
        const line = document.createElement('div');
        line.style.color = "#8892b0";
        line.style.marginBottom = "4px";
        line.innerText = `> ${output}`;
        outputElement.appendChild(line);
        if(outputElement.children.length > 2) outputElement.removeChild(outputElement.firstChild);
    }

    type();

    // Mobile Menu Toggle
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    
    if(hamburger) {
        hamburger.addEventListener('click', () => {
            navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
            if(navLinks.style.display === 'flex') {
                navLinks.style.flexDirection = 'column';
                navLinks.style.position = 'absolute';
                navLinks.style.top = '70px';
                navLinks.style.right = '0';
                navLinks.style.background = '#112240';
                navLinks.style.width = '100%';
                navLinks.style.padding = '20px';
            }
        });
    }
});