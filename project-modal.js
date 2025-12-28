// Image Modal Functions for Project Screenshots

function openImageModal(imageSrc, caption) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalCaption');
    
    modal.style.display = 'block';
    modalImg.src = imageSrc;
    modalCaption.textContent = caption;
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    
    // Restore body scroll
    document.body.style.overflow = '';
}

// Close modal when clicking outside the image
document.getElementById('imageModal')?.addEventListener('click', function(event) {
    if (event.target === this) {
        closeImageModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const modal = document.getElementById('imageModal');
        if (modal && modal.style.display === 'block') {
            closeImageModal();
        }
    }
});
